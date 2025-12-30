import { getClient } from "../weaviate.js";
import Model from "../model.js";

function coerceBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

async function ensureCollection(client, { collectionName, collectionDefinition}, overwrite) {
  console.log("Preparing collection:", collectionName, "overwrite:", overwrite);
  const exists = await client.collections.exists(collectionName);
  if (exists) {
    if (!overwrite) {
      console.log("Collection exists, skipping:", collectionName);
      return;
    }
    await client.collections.delete(collectionName);
  }
  await client.collections.create(collectionDefinition);
}

export async function handler(event) {
  const client = await getClient();
  const overwrite = coerceBoolean(event?.overwrite ?? false);

  await ensureCollection(client, Model.companyAssessment, overwrite);
  await ensureCollection(client, Model.companyMasterData, overwrite);
  await ensureCollection(client, Model.competingCompanies, overwrite);
  await ensureCollection(client, Model.marketAnalysis, overwrite);
  await ensureCollection(client, Model.companyNews, overwrite);
}
