import { getClient } from "../../weaviate.js";
import GenerateCompetition, { requestValidator } from "../../cmd/generateCompetition.js";
import GenerateMasterData from "../../cmd/generateMasterData.js";
import Model from "../../model.js";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
const model = Model.competingCompanies;
const sqs = new SQSClient({});

export async function handler(event) {

  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    let competition = await model.fetchObject(wv, req.customerDomain);
    const foundEntry = competition != null;

    if (!foundEntry) {
      console.log("Could not find competition list, will generate.", req.customerDomain);
      competition = await GenerateCompetition(req);
      await model.insertObject(wv, competition);
    } else {
      console.log("Found competition list, will skip", req.customerDomain);
    }

    const competitionEntries = competition?.competition ?? [];
    const processedDomains = new Set();
    const customerMaster = await Model.companyMasterData.fetchObject(
      wv,
      req.customerDomain
    );

    if (!customerMaster) {
      console.warn(
        "Missing customer master data before linking competitors",
        req.customerDomain
      );
    }

    for (const item of competitionEntries) {
      if (!item?.competitionDomain || processedDomains.has(item.competitionDomain)) {
        continue;
      }
      processedDomains.add(item.competitionDomain);

      const competitorReq = {
        customerDomain: req.customerDomain,
        domain: item.competitionDomain,
        legalName: item.competitionLegalName,
        subjectType: "competitor",
      };

      let competitorMaster = await Model.companyMasterData.fetchObject(
        wv,
        competitorReq.domain
      );
      if (!competitorMaster) {
        competitorMaster = await GenerateMasterData(competitorReq);
        await Model.companyMasterData.insertObject(wv, competitorMaster);
      }

      if (customerMaster && competitorMaster) {
        await Model.companyMasterData.linkObjects(
          wv,
          "competingCompanies",
          customerMaster,
          competitorMaster
        );
      }

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: Resource.AssessmentQueue.url,
          MessageBody: JSON.stringify(competitorReq),
        })
      );
    }
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}
