import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import OpenAI from "openai";
import { Resource } from "sst";
import { z } from "zod";
import { getClient } from "../../weaviate.js";
import GenerateCompetitionAnalysis from "../../cmd/generateCompetitionAnalysis.js";
import Model, { domain, legalName } from "../../model.js";
import ValidationCreator from "../../util/request.js";

const requestSchema = z.object({
  customerDomain: domain,
  competitorDomain: domain,
  customerLegalName: legalName,
  competitorLegalName: legalName,
  customerVectorStoreId: z.string().min(1),
  competitorVectorStoreId: z.string().min(1),
  customerMarketAnalysisId: z.string().min(1),
  competitorMarketAnalysisId: z.string().min(1),
});

const requestValidator = ValidationCreator(requestSchema);

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});
const sqs = new SQSClient({});

const QUESTION_PROMPT =
  "Compare competitive strengths and weaknesses, niche positioning, market trends, and customer expectations for customer vs competitor.";
const MAX_ANALYSIS_CHARS = 5000;
const MAX_PRIOR_CONTEXT_CHARS = 1500;

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    const competitionId = `${req.customerDomain}|${req.competitorDomain}`;
    const existing = await Model.competitionAnalysis.fetchObject(wv, competitionId);
    if (existing) {
      console.log("Competition analysis already exists, skipping", competitionId);
      await enqueueITStrategy(req);
      continue;
    }

    const customerMarketAnalysis = await Model.marketAnalysis.fetchObject(
      wv,
      req.customerMarketAnalysisId
    );
    const competitorMarketAnalysis = await Model.marketAnalysis.fetchObject(
      wv,
      req.competitorMarketAnalysisId
    );

    if (!customerMarketAnalysis || !competitorMarketAnalysis) {
      console.warn("Missing market analysis context", {
        customer: req.customerMarketAnalysisId,
        competitor: req.competitorMarketAnalysisId,
      });
      continue;
    }

    const queryVector = await createQueryVector();
    const customerContext = await fetchMarketAnalysisContext(
      wv,
      req.customerDomain,
      queryVector
    );
    const competitorContext = await fetchMarketAnalysisContext(
      wv,
      req.competitorDomain,
      queryVector
    );
    const priorCompetition = await fetchCompetitionContext(wv, queryVector);

    const enrichedCustomerAnalysis = buildAnalysisContext(
      customerMarketAnalysis?.analysis,
      customerContext,
      MAX_ANALYSIS_CHARS
    );
    const enrichedCompetitorAnalysis = buildAnalysisContext(
      competitorMarketAnalysis?.analysis,
      competitorContext,
      MAX_ANALYSIS_CHARS
    );
    const priorContext = buildAnalysisContext(
      "",
      priorCompetition,
      MAX_PRIOR_CONTEXT_CHARS
    );

    const competitionAnalysis = await GenerateCompetitionAnalysis({
      ...req,
      customerMarketAnalysis: `${enrichedCustomerAnalysis}\n\n${priorContext}`.trim(),
      competitorMarketAnalysis: `${enrichedCompetitorAnalysis}\n\n${priorContext}`.trim(),
    });

    competitionAnalysis.competitionId = competitionId;

    try {
      await Model.competitionAnalysis.insertObject(wv, competitionAnalysis);
    } catch (error) {
      if (!isDuplicateIdError(error)) {
        throw error;
      }
      console.log("Competition analysis already exists, skipping insert.", competitionId);
    }

    await linkCompetition(wv, competitionAnalysis);
    await enqueueITStrategy(req);
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}

async function createQueryVector() {
  const response = await oc.embeddings.create({
    model: "text-embedding-3-small",
    input: QUESTION_PROMPT,
  });
  return response.data[0].embedding;
}

async function fetchMarketAnalysisContext(client, domain, queryVector) {
  const col = client.collections.use(Model.marketAnalysis.collectionName);
  const { objects } = await col.query.nearVector(queryVector, {
    targetVector: "competitionAnalysisLense",
    limit: 5,
    filters: col.filter.byProperty("domain").equal(domain),
    returnProperties: ["analysis", "domain", "customerDomain", "subjectType"],
  });
  return objects ?? [];
}

async function fetchCompetitionContext(client, queryVector) {
  const col = client.collections.use(Model.competitionAnalysis.collectionName);
  const { objects } = await col.query.nearVector(queryVector, {
    limit: 3,
    returnProperties: [
      "analysis",
      "customerDomain",
      "competitorDomain",
      "customerLegalName",
      "competitorLegalName",
    ],
  });
  return objects ?? [];
}

function buildAnalysisContext(base, objects, maxChars) {
  const baseText = typeof base === "string" ? base : "";
  const extras =
    objects
      ?.map((entry) => entry?.properties?.analysis)
      ?.filter((text) => typeof text === "string" && text.trim().length > 0) ?? [];

  const parts = [];
  let currentSize = 0;

  for (const text of [baseText, ...extras]) {
    if (!text) {
      continue;
    }
    const next = text.trim();
    if (!next) {
      continue;
    }
    const nextSize = next.length + (parts.length ? 2 : 0);
    if (currentSize + nextSize > maxChars) {
      const remaining = maxChars - currentSize - (parts.length ? 2 : 0);
      if (remaining > 0) {
        parts.push(next.slice(0, remaining));
      }
      break;
    }
    parts.push(next);
    currentSize += nextSize;
  }

  return parts.join("\n\n");
}

async function enqueueITStrategy(req) {
  const payload = {
    customerDomain: req.customerDomain,
    subjectType: "customer",
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: Resource.ITStrategyQueue.url,
      MessageBody: JSON.stringify(payload),
    })
  );
}

async function linkCompetition(client, competitionAnalysis) {
  const customerMaster = await Model.companyMasterData.fetchObject(
    client,
    competitionAnalysis.customerDomain
  );
  const competitorMaster = await Model.companyMasterData.fetchObject(
    client,
    competitionAnalysis.competitorDomain
  );

  if (!customerMaster) {
    console.warn("Missing customer master data for competition analysis", competitionAnalysis.customerDomain);
  }
  if (!competitorMaster) {
    console.warn("Missing competitor master data for competition analysis", competitionAnalysis.competitorDomain);
  }

  if (customerMaster) {
    await Model.companyMasterData.linkObjects(
      client,
      "competitionAnalysis",
      customerMaster,
      competitionAnalysis
    );
  }

  if (competitorMaster) {
    await Model.competitionAnalysis.linkObjects(
      client,
      "competitionMasterData",
      competitionAnalysis,
      competitorMaster
    );
  }
}

function isDuplicateIdError(error) {
  const message = error?.message ?? "";
  return message.includes("already exists") || message.includes("status code: 422");
}
