import { z } from "zod";
import ValidationCreator from "../../util/request.js";
import OpenAI from "openai";
import { Resource } from "sst";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z
  .object({
    vectorStoreId: z.string().min(1).optional(),
    vectorStoreName: z.string().min(1),
    batchId: z.string().min(1),
    context: z
      .object({
        domain: z.string().min(1),
        legalName: z.string().min(1),
        industries: z.array(z.string().min(1)),
        markets: z.array(z.string().min(1)),
      })
      .passthrough(),
  })
  .passthrough();

const validator = ValidationCreator(requestSchema);

export async function handler(event) {
  console.log("[VECTORSTORE_CHECK_BATCH_EVENT]", JSON.stringify(event));
  const req = validator(event);
  const vectorStoreId = await resolveVectorStoreId(req);
  if (!vectorStoreId) {
    throw new Error("Vector store id missing for batch lookup.");
  }
  const batch = await oc.vectorStores.fileBatches.retrieve(req.batchId, {
    vector_store_id: vectorStoreId,
  });

  if (batch.status === "completed") {
    return {
      ...req,
      status: batch.status,
    };
  }

  if (batch.status === "failed" || batch.status === "cancelled") {
    throw createError(
      "BatchFailed",
      `Batch ${req.batchId} is ${batch.status}`
    );
  }

  throw createError("BatchPending", `Batch ${req.batchId} is ${batch.status}`);
}

function createError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

async function resolveVectorStoreId(req) {
  if (req.vectorStoreId) {
    return req.vectorStoreId;
  }

  const stores = await oc.vectorStores.list({ limit: 100 });
  const existing = stores.data.find((vs) => vs.name === req.vectorStoreName);
  if (!existing?.id) {
    throw new Error(`Vector store not found: ${req.vectorStoreName}`);
  }
  return existing.id;
}
