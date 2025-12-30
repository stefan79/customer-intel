import { getClient } from "../../weaviate.js";
import GenerateMarketAnalysis, {
  requestValidator,
} from "../../cmd/generateMarketAnalysis.js";
import Model from "../../model.js";
import EmbedMarketAnalysis from "../../cmd/embedMarketAnalysis.js"

const model = Model.marketAnalysis;

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    let analysis = await model.fetchObject(wv, req.domain);
    const foundEntry = analysis != null;

    if (!foundEntry) {
      console.log("Could not find market analysis, will generate.", req.domain);
      analysis = await GenerateMarketAnalysis(req);
      const master = await Model.companyMasterData.fetchObject(wv, req.domain)
      const assessment = await Model.companyAssessment.fetchObject(wv, req.domain)
      const vectors = await EmbedMarketAnalysis(master, assessment, analysis)
      await model.insertObject(wv, analysis, vectors);
      await Model.companyMasterData.linkObjects(wv, "marketAnalysis", master, analysis)
    } else {
      console.log("Found market analysis, will skip", req.domain);
    }
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}
