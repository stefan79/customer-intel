import OpenAI from "openai";
import Model from "../model.js"
import { Resource } from "sst";
import { getClient } from "../weaviate.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

export default async function (master) {

  Model.companyMasterData.validate(master)
  
  const response = await oc.embeddings.create({
    model: "text-embedding-3-small",
    input: "Produce a market and customer-demand analysis: market context, demand patterns, company offering, trends, implications.",
  })

  const wv = await getClient()

  const questionVector = response.data[0].embedding

  const col = wv.collections.use(Model.marketAnalysis.collectionName)
  
  await col.query.nearVector({
    targetVector: "swot",
    vector: questionVector,
    limit: 20,
    filters: col.filter.byProperty("domain").equal(master.domain),
    returnProperties: ["domain", "analysis"]
  });








}
