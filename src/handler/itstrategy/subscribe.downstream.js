import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import OpenAI from "openai";
import { Resource } from "sst";
import { z } from "zod";
import generateITStrategy from "../../cmd/generateITStrategy.js";
import { getClient } from "../../weaviate.js";
import Model, { domain, subjectType } from "../../model.js";
import ValidationCreator from "../../util/request.js";

const requestSchema = z.object({
  customerDomain: domain,
  subjectType: subjectType.optional(),
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
}));

const requestValidator = ValidationCreator(requestSchema);

const sqs = new SQSClient({});
const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const EVIDENCE_QUERY =
  "Evidence for IT strategy: competitive strengths/weaknesses, market positioning, trend alignment, innovation posture, customer expectations.";
const MAX_EVIDENCE = 12;

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    const strategyId = req.customerDomain;
    let strategy = await Model.itStrategy.fetchObject(wv, strategyId);

    if (!strategy) {
      console.log("Generating IT strategy", req.customerDomain);
      const master = await Model.companyMasterData.fetchObject(wv, req.customerDomain);
      if (!master) {
        console.warn("Missing master data for IT strategy", req.customerDomain);
        continue;
      }

      const marketAnalysis = await Model.marketAnalysis.fetchObject(wv, req.customerDomain);
      if (!marketAnalysis) {
        console.warn("Missing market analysis for IT strategy", req.customerDomain);
        continue;
      }

      const competitionAnalyses = await fetchCompetitionAnalyses(wv, req.customerDomain);
      let evidence = await collectEvidence(wv, req.customerDomain, competitionAnalyses);
      if (!evidence.length && marketAnalysis?.analysis) {
        evidence = [
          {
            id: `${req.customerDomain}-market-analysis`,
            source: req.customerDomain,
            text: truncateText(marketAnalysis.analysis, 800),
          },
        ];
      }

      strategy = await generateITStrategy({
        customerDomain: req.customerDomain,
        subjectType: req.subjectType,
        customerLegalName: master.legalName,
        companyProfile: master,
        companyMarketAnalysis: marketAnalysis,
        competitionAnalysis: competitionAnalyses,
        evidence,
      });

      try {
        await Model.itStrategy.insertObject(wv, strategy);
      } catch (error) {
        if (!isDuplicateIdError(error)) {
          throw error;
        }
        strategy = await Model.itStrategy.fetchObject(wv, strategyId);
      }

      await Model.companyMasterData.linkObjects(wv, "itStrategy", master, strategy);
    } else {
      console.log("IT strategy already exists, skipping generation", req.customerDomain);
    }

    await enqueueServiceMatching(req, strategy);
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}

async function enqueueServiceMatching(req, strategy) {
  if (!strategy) {
    console.warn("Missing IT strategy, cannot enqueue service matching", req.customerDomain);
    return;
  }

  const vendorCatalogVectorStoreId = Resource.VendorCatalogVectorStoreId?.value;
  if (!vendorCatalogVectorStoreId) {
    console.warn("VendorCatalogVectorStoreId is not configured; skipping service matching enqueue");
    return;
  }

  const payload = {
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    customerLegalName: strategy.customerLegalName,
    itStrategyId: strategy.id,
    vendorCatalogVectorStoreId,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: Resource.ServiceMatchingQueue.url,
      MessageBody: JSON.stringify(payload),
    })
  );
}

async function fetchCompetitionAnalyses(client, customerDomain) {
  const col = client.collections.use(Model.competitionAnalysis.collectionName);
  const { objects } = await col.query.hybrid(
    customerDomain,
    {
      limit: 8,
      filters: col.filter.byProperty("customerDomain").equal(customerDomain),
      returnProperties: [
        "competitionId",
        "customerDomain",
        "competitorDomain",
        "customerLegalName",
        "competitorLegalName",
        "analysis",
        "summary",
      ],
    }
  );

  return (
    objects?.map((entry) => ({
      competitorDomain: entry?.properties?.competitorDomain,
      competitorLegalName: entry?.properties?.competitorLegalName,
      analysis: entry?.properties?.analysis,
      summary: entry?.properties?.summary,
    }))?.filter((entry) => entry?.competitorDomain && entry?.analysis) ?? []
  );
}

async function collectEvidence(client, customerDomain, competitionAnalyses) {
  const queryVector = await createQueryVector();
  const customerEvidence = await fetchMarketEvidence(
    client,
    customerDomain,
    queryVector
  );

  const competitorEvidence = [];
  for (const entry of competitionAnalyses ?? []) {
    const items = await fetchMarketEvidence(
      client,
      entry.competitorDomain,
      queryVector,
      2
    );
    competitorEvidence.push(...items);
  }

  const combined = [...customerEvidence, ...competitorEvidence];
  const deduped = [];
  const seen = new Set();
  for (const item of combined) {
    const key = item.source ?? item.id;
    if (key && !seen.has(key)) {
      deduped.push(item);
      seen.add(key);
    }
    if (deduped.length >= MAX_EVIDENCE) {
      break;
    }
  }
  return deduped;
}

async function fetchMarketEvidence(client, domainId, vector, limit = 8) {
  const col = client.collections.use(Model.marketAnalysis.collectionName);
  const { objects } = await col.query.nearVector(vector, {
    targetVector: "marketAnalysisText",
    limit,
    filters: col.filter.byProperty("domain").equal(domainId),
    returnProperties: ["analysis", "domain", "customerDomain", "subjectType"],
  });

  return (
    objects?.map((entry) => ({
      id: entry?.uuid ?? entry?.properties?.domain ?? domainId,
      source: entry?.properties?.domain ?? domainId,
      text: entry?.properties?.analysis,
    }))?.filter((item) => item.text)?.map((item) => ({
      ...item,
      text: truncateText(item.text, 800),
    })) ?? []
  );
}

async function createQueryVector() {
  const response = await oc.embeddings.create({
    model: "text-embedding-3-small",
    input: EVIDENCE_QUERY,
  });
  return response.data[0].embedding;
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function isDuplicateIdError(error) {
  const message = error?.message ?? "";
  return message.includes("already exists") || message.includes("status code: 422");
}
