import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getClient } from "../../weaviate.js";
import Model from "../../model.js";
import GenerateMasterData, {requestValidator} from "../../cmd/generateMasterData.js"


const sqs = new SQSClient({});
const model = Model.companyMasterData

export async function handler(event) {
  
  const req = requestValidator(event)
  const wv = await getClient()

  const foundEntry = (await model.fetchObject(wv, req.domain)  != null)
  
  if (! foundEntry) {
    console.log("Did not find any existing data, will generate for domain", req.domain)
    const masterdata = await GenerateMasterData(req)
    await model.insertObject(wv, masterdata)
  } else {
    console.log("Master Data already found, will skip generation ", req.domain)
  }
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: Resource.AssessmentQueue.url,
      MessageBody: JSON.stringify(req),
    })
  );

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}
