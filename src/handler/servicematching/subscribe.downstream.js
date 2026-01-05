import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { z } from "zod";
import generateServiceMatching from "../../cmd/generateServiceMatching.js";
import { getClient } from "../../weaviate.js";
import Model, { domain, subjectType, legalName } from "../../model.js";
import ValidationCreator from "../../util/request.js";

const requestSchema = z.object({
  customerDomain: domain,
  subjectType: subjectType.optional(),
  customerLegalName: legalName,
  itStrategyId: z.string().min(1),
  vendorCatalogVectorStoreId: z.string().min(1).optional(),
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
}));

const requestValidator = ValidationCreator(requestSchema);
const sqs = new SQSClient({});

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const vendorCatalogVectorStoreId =
      req.vendorCatalogVectorStoreId ?? Resource.VendorCatalogVectorStoreId?.value;

    if (!vendorCatalogVectorStoreId) {
      console.warn("Vendor catalog vector store id missing, skipping service matching", req.customerDomain);
      continue;
    }

    const wv = await getClient();
    const serviceMatchingId = req.customerDomain;

    let matching = await Model.serviceMatching.fetchObject(wv, serviceMatchingId);
    if (!matching) {
      const master = await Model.companyMasterData.fetchObject(wv, req.customerDomain);
      if (!master) {
        console.warn("Missing master data for service matching", req.customerDomain);
        continue;
      }

      const itStrategy = await Model.itStrategy.fetchObject(wv, req.itStrategyId);
      if (!itStrategy) {
        console.warn("Missing IT strategy for service matching", req.itStrategyId);
        continue;
      }

      matching = await generateServiceMatching({
        customerDomain: req.customerDomain,
        subjectType: req.subjectType,
        customerLegalName: req.customerLegalName,
        itStrategy,
        companyProfile: master,
        vendorCatalogVectorStoreId,
      });

      try {
        await Model.serviceMatching.insertObject(wv, matching);
      } catch (error) {
        if (!isDuplicateIdError(error)) {
          throw error;
        }
        matching = await Model.serviceMatching.fetchObject(wv, serviceMatchingId);
      }

      await Model.companyMasterData.linkObjects(wv, "serviceMatching", master, matching);
    } else {
      console.log("Service matching already exists, skipping generation", req.customerDomain);
    }

    await enqueueSalesMeetingPrep(req, matching);
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}

async function enqueueSalesMeetingPrep(req, matching) {
  if (!matching) {
    console.warn("Missing service matching output, cannot enqueue sales meeting prep", req.customerDomain);
    return;
  }

  const payload = {
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    customerLegalName: matching.customerLegalName ?? req.customerLegalName,
    itStrategyId: req.itStrategyId,
    serviceMatchingId: matching.id,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: Resource.SalesMeetingPrepQueue.url,
      MessageBody: JSON.stringify(payload),
    })
  );
}

function isDuplicateIdError(error) {
  const message = error?.message ?? "";
  return message.includes("already exists") || message.includes("status code: 422");
}
