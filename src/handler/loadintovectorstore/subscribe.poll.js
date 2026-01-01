import { z } from "zod";
import ValidationCreator from "../../util/request.js";
import { Resource } from "sst";
import OpenAI, { toFile } from "openai";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getClient } from "../../weaviate.js";
import Model from "../../model.js";
import GenerateMarkdownFallback from "../../cmd/generateMarkdownFallback.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});
const sqs = new SQSClient({});

const requestSchema = z
  .object({
    domain: z.string().describe("The url of the file to download"),
    customerDomain: z.string().optional(),
    url: z.string().describe("The url of the file to download"),
    fallback: z.string().describe("Body to use if the url fails to download"),
    vectorStore: z.string().describe("The vector store to add this file to"),
    type: z.string().describe("The typpe of document like news, etc."),
    subjectType: z.string().optional(),
  })
  .transform((value) => ({
    ...value,
    customerDomain: value.customerDomain ?? value.domain,
    subjectType: value.subjectType ?? "customer",
  }))
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
      entry.context = await getMarketAnalysisContext(req);
    }
  }

  for (const [vectorStoreName, entry] of fileIdsByStore.entries()) {
    if (!entry.fileIds.length) {
      continue;
    }
    const vs = await getOrCreateVectorStore(vectorStoreName);
    await oc.vectorStores.fileBatches.createAndPoll(vs.id, {
      file_ids: entry.fileIds,
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: Resource.MarketAnalysisQueue.url,
        MessageBody: JSON.stringify({
          legalName: entry.context.legalName,
          domain: entry.context.domain,
          customerDomain: entry.context.customerDomain,
          subjectType: entry.context.subjectType,
          industries: entry.context.industries,
          markets: entry.context.markets,
          vectorStoreId: vs.id,
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

async function getMarketAnalysisContext(req) {
  const cacheKey = `${req.customerDomain}|${req.domain}|${req.subjectType}`;
  if (contextCache.has(cacheKey)) {
    return await contextCache.get(cacheKey);
  }

  const pending = (async () => {
    const wv = await getClient();
    const master = await Model.companyMasterData.fetchObject(wv, req.domain);
    const assessment = await Model.companyAssessment.fetchObject(wv, req.domain);

    if (!master || !assessment) {
      throw new Error(`Missing market analysis context for ${req.domain}`);
    }

    return {
      legalName: master.legalName,
      domain: req.domain,
      customerDomain: req.customerDomain,
      subjectType: req.subjectType,
      industries: assessment.industries?.value ?? [],
      markets: assessment.markets?.value ?? [],
    };
  })();

  contextCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    contextCache.delete(cacheKey);
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
