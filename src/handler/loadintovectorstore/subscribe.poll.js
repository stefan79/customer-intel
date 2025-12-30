import { z } from "zod";
import ValidationCreator from "../../util/request.js"
import { Resource } from "sst";
import OpenAI from "openai";


const oc = new OpenAI({
    apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  domain: z.string().describe("The url of the file to download"), 
  url: z.string().describe("The url of the file to download"),
  fallback: z.string().describe("Body to use if the url fails to download"),
  vectorStore: z.string().describe("The vector store to add this file to"),
  type: z.string().describe("The typpe of document like news, etc."),
}).describe("Request to generate company news for a company");

const validator = ValidationCreator(requestSchema)
const vectorStoreCache = new Map();

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = validator(record.body)
    const vsName = req.vectorStore
    const file = await uploadFileViaUrl(req.url)
    const vs = await getOrCreateVectorStore(vsName)

    //Have to add some polling logic here or add the callbacks....
    await oc.vectorStores.files.create(vs.id, {
      file_id: file.id
    })

  }

}

async function uploadFileViaUrl(url) {
  const res = await fetch(url)
  if(!res.ok || !res.body){
    throw new Error("Download failed", url);
  }

  return await oc.files.create({
    file:  res,
    purpose: "user_data",
  });
}


async function getOrCreateVectorStore(name) {
  if (vectorStoreCache.has(name)) {
    return await vectorStoreCache.get(name);
  }

  const pending = (async () => {
    // List vector stores (paginated; keep simple here)
    const stores = await oc.vectorStores.list({ limit: 100 });

    const existing = stores.data.find(vs => vs.name === name);
    if (existing) {
      return existing;
    }

    // Create if not found
    return await oc.vectorStores.create({ name });
  })();

  vectorStoreCache.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    vectorStoreCache.delete(name);
    throw error;
  }
}
