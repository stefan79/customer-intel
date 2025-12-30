import { getClient } from "../../weaviate.js";
import GenerateCompetition, { requestValidator } from "../../cmd/generateCompetition.js";
import Model from "../../model.js";
const model = Model.competingCompanies;

export async function handler(event) {

  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();

    let competition = await model.fetchObject(wv, req.domain);
    const foundEntry = competition != null;

    if (!foundEntry) {
      console.log("Could not find competition list, will generate.", req.domain);
      competition = await GenerateCompetition(req);
      await model.insertObject(wv, competition);
    } else {
      console.log("Found competition list, will skip", req.domain);
    }

    console.log(competition);
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}
