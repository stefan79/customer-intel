import { z } from "zod";
import generateSalesMeetingPrep from "../../cmd/generateSalesMeetingPrep.js";
import { getClient } from "../../weaviate.js";
import Model, { domain, subjectType, legalName } from "../../model.js";
import ValidationCreator from "../../util/request.js";

const requestSchema = z.object({
  customerDomain: domain,
  subjectType: subjectType.optional(),
  customerLegalName: legalName,
  itStrategyId: z.string().min(1),
  serviceMatchingId: z.string().min(1),
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
}));

const requestValidator = ValidationCreator(requestSchema);

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();
    const salesPrepId = req.customerDomain;

    let prep = await Model.salesMeetingPrep.fetchObject(wv, salesPrepId);
    if (!prep) {
      const master = await Model.companyMasterData.fetchObject(wv, req.customerDomain);
      if (!master) {
        console.warn("Missing master data for sales meeting prep", req.customerDomain);
        continue;
      }

      const itStrategy = await Model.itStrategy.fetchObject(wv, req.itStrategyId);
      if (!itStrategy) {
        console.warn("Missing IT strategy for sales meeting prep", req.itStrategyId);
        continue;
      }

      const serviceMatching = await Model.serviceMatching.fetchObject(
        wv,
        req.serviceMatchingId
      );
      if (!serviceMatching) {
        console.warn("Missing service matching for sales meeting prep", req.serviceMatchingId);
        continue;
      }

      prep = await generateSalesMeetingPrep({
        customerDomain: req.customerDomain,
        subjectType: req.subjectType,
        customerLegalName: req.customerLegalName,
        companyProfile: master,
        itStrategy,
        serviceMatching,
      });

      try {
        await Model.salesMeetingPrep.insertObject(wv, prep);
      } catch (error) {
        if (!isDuplicateIdError(error)) {
          throw error;
        }
        prep = await Model.salesMeetingPrep.fetchObject(wv, salesPrepId);
      }

      await Model.companyMasterData.linkObjects(wv, "salesMeetingPrep", master, prep);
    } else {
      console.log("Sales meeting prep already exists, skipping generation", req.customerDomain);
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
