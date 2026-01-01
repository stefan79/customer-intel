import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getClient } from "../../weaviate.js";
import GenerateMarketAnalysis, {
  requestValidator,
} from "../../cmd/generateMarketAnalysis.js";
import generateCompetitionAnalysisEmbedding from "../../cmd/generateCompetitionAnalysisEmbedding.js";
import Model from "../../model.js";

const model = Model.marketAnalysis;
const sqs = new SQSClient({});

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    let analysis = await model.fetchObject(wv, req.domain);
    const foundEntry = analysis != null;

    if (!foundEntry) {
      console.log("Could not find market analysis, will generate.", req.domain, req.subjectType);
      analysis = await GenerateMarketAnalysis(req);
      try {
        const competitionVector = await generateCompetitionAnalysisEmbedding({
          analysis: analysis.analysis,
        });
        const vectors = competitionVector?.length
          ? { competitionAnalysisLense: competitionVector }
          : undefined;
        await model.insertObject(wv, analysis, vectors);
      } catch (error) {
        if (!isDuplicateIdError(error)) {
          throw error;
        }
        console.log("Market analysis already exists, skipping insert.", req.domain);
        analysis = await model.fetchObject(wv, req.domain);
      }
      const master = await Model.companyMasterData.fetchObject(wv, req.domain)
      if (master) {
        await Model.companyMasterData.linkObjects(wv, "marketAnalysis", master, analysis)
      } else {
        console.warn("Missing master data while linking market analysis", req.domain)
      }
    } else {
      console.log("Found market analysis, will skip", req.domain, req.subjectType);
    }

    if (req.subjectType === "competitor") {
      await enqueueCompetitionAnalysis(wv, req, analysis);
    }
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}

function isDuplicateIdError(error) {
  const message = error?.message ?? "";
  return message.includes("already exists") || message.includes("status code: 422");
}

async function enqueueCompetitionAnalysis(wv, req, competitorMarketAnalysis) {
  const customerMarketAnalysis = await Model.marketAnalysis.fetchObject(
    wv,
    req.customerDomain
  );

  if (!customerMarketAnalysis || !competitorMarketAnalysis) {
    console.warn("Missing market analysis for competition job", {
      customer: req.customerDomain,
      competitor: req.domain,
    });
    return;
  }

  const customerMaster = await Model.companyMasterData.fetchObject(wv, req.customerDomain);
  const competitorMaster = await Model.companyMasterData.fetchObject(wv, req.domain);

  if (!customerMaster || !competitorMaster) {
    console.warn("Missing master data for competition job", {
      customer: req.customerDomain,
      competitor: req.domain,
    });
    return;
  }

  const message = {
    customerDomain: req.customerDomain,
    competitorDomain: req.domain,
    customerLegalName: customerMaster.legalName,
    competitorLegalName: competitorMaster.legalName,
    customerVectorStoreId: customerMarketAnalysis.vectorStoreId,
    competitorVectorStoreId: competitorMarketAnalysis.vectorStoreId,
    customerMarketAnalysisId: customerMarketAnalysis.domain,
    competitorMarketAnalysisId: competitorMarketAnalysis.domain,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: Resource.CompetitionAnalysisQueue.url,
      MessageBody: JSON.stringify(message),
    })
  );
}
