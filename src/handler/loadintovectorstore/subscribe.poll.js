import { z } from "zod";
import ValidationCreator from "../../util/request.js";
import { Resource } from "sst";
import OpenAI, { toFile } from "openai";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { getClient } from "../../weaviate.js";
import Model from "../../model.js";
import GenerateMarkdownFallback from "../../cmd/generateMarkdownFallback.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});
const sfn = new SFNClient({});

const requestSchema = z
  .object({
    domain: z.string().describe("The url of the file to download"),
    url: z.string().describe("The url of the file to download"),
    fallback: z.string().describe("Body to use if the url fails to download"),
    vectorStore: z.string().describe("The vector store to add this file to"),
    type: z.string().describe("The typpe of document like news, etc."),
  })
  .describe("Request to generate company news for a company");

const validator = ValidationCreator(requestSchema);
const vectorStoreCache = new Map();
const contextCache = new Map();

export async function handler(event) {
  const fileIdsByStore = new Map();

  for (const record of event.Records ?? []) {
    const req = validator(record.body);
    const file = await uploadFileWithFallback(req);
    const entry = getOrCreateBatchEntry(fileIdsByStore, req.vectorStore);
    entry.fileIds.push(file.id);
    if (!entry.context) {
      entry.context = await getMarketAnalysisContext(req.domain);
    }
  }

  for (const [vectorStoreName, entry] of fileIdsByStore.entries()) {
    if (!entry.fileIds.length) {
      continue;
    }
    const vs = await getOrCreateVectorStore(vectorStoreName);
    const batch = await oc.vectorStores.fileBatches.create(vs.id, {
      file_ids: entry.fileIds,
    });

    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: Resource.VectorStoreBatchFlow.arn,
        input: JSON.stringify({
          vectorStoreId: vs.id,
          vectorStoreName,
          batchId: batch.id,
          context: entry.context,
        }),
      })
    );
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}

function getOrCreateBatchEntry(map, vectorStoreName) {
  if (!map.has(vectorStoreName)) {
    map.set(vectorStoreName, {
      fileIds: [],
      context: null,
    });
  }
  return map.get(vectorStoreName);
}

async function uploadFileWithFallback(req) {
  try {
    return await uploadFileViaUrl(req.url);
  } catch (error) {
    console.log("Download failed, generating markdown fallback", req.url);
    const markdown = await GenerateMarkdownFallback({
      domain: req.domain,
      type: req.type,
      fallback: req.fallback,
      url: req.url,
    });
    return await uploadMarkdownFile(markdown, req.domain);
  }
}

async function uploadFileViaUrl(url) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed for ${url}`);
  }

  return await oc.files.create({
    file: res,
    purpose: "user_data",
  });
}

async function uploadMarkdownFile(markdown, domain) {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
  const file = await toFile(
    Buffer.from(markdown, "utf8"),
    `${safeDomain}-${Date.now()}.md`
  );

  return await oc.files.create({
    file,
    purpose: "user_data",
  });
}

async function getMarketAnalysisContext(domain) {
  if (contextCache.has(domain)) {
    return await contextCache.get(domain);
  }

  const pending = (async () => {
    const wv = await getClient();
    const master = await Model.companyMasterData.fetchObject(wv, domain);
    const assessment = await Model.companyAssessment.fetchObject(wv, domain);

    if (!master || !assessment) {
      throw new Error(`Missing market analysis context for ${domain}`);
    }

    return {
      legalName: master.legalName,
      domain,
      industries: assessment.industries?.value ?? [],
      markets: assessment.markets?.value ?? [],
    };
  })();

  contextCache.set(domain, pending);
  try {
    return await pending;
  } catch (error) {
    contextCache.delete(domain);
    throw error;
  }
}

async function getOrCreateVectorStore(name) {
  if (vectorStoreCache.has(name)) {
    return await vectorStoreCache.get(name);
  }

  const pending = (async () => {
    const stores = await oc.vectorStores.list({ limit: 100 });
    const existing = stores.data.find((vs) => vs.name === name);
    if (existing) {
      return existing;
    }

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
