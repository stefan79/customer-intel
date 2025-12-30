import { getClient, mapZodToWeaviateProperties } from "../weaviate.js";
import Model from "../model.js";

async function resetCollection(client, {zodSchema, collectionName}) {
  console.log("Ready to reset: ", collectionName)
  const exists = await client.collections.exists(collectionName);
  if (exists) {
    await client.collections.delete(collectionName);
  }
  await client.collections.create({
    name: collectionName,
    properties: mapZodToWeaviateProperties(zodSchema),
  });
}

export async function handler() {
  const client = await getClient();

  await resetCollection(client, Model.companyAssessment);
  await resetCollection(client, Model.companyMasterData);
  await resetCollection(client, Model.competingCompanies);
}
