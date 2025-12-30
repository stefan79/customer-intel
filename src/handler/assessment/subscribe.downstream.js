import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getClient } from "../../weaviate.js";
import GenerateAssessment, { requestValidator } from "../../cmd/generateAssessment.js";
import Model from "../../model.js";

const sqs = new SQSClient({});
const model = Model.companyAssessment

export async function handler(event) {
    for (const record of event.Records ?? []) {
        const req = requestValidator(record.body)
        
        const wv = await getClient()
        var assessment = await model.fetchObject(wv, req.domain)
        const foundEntry = (assessment  != null)
        if(!foundEntry){
            console.log("Could not find any assessment, will generate", req.domain);
            assessment = await GenerateAssessment(record.body)
            await model.insertObject(wv, assessment)
            const masterData = await Model.companyMasterData.fetchObject(wv, req.domain)
            await Model.companyMasterData.linkObjects(wv, "assessment", masterData, assessment)
        } else {
            console.log("Found assessment, will skip", req.domain)
        }

        const competitionReq = {
            ...req,
            revenueInMio: assessment.revenueInMio.value,
            industries: assessment.industries.value,
            markets: assessment.markets.value
        }

        const marketAnalysisReq = {
            legalName: req.legalName,
            domain: req.domain,
            industries: assessment.industries.value,
            markets: assessment.markets.value
        }

        const newsReq = {
            legalCompanyName: req.legalName,
            domain: req.domain
        }

        await sqs.send(
            new SendMessageCommand({
                QueueUrl: Resource.CompetitionQueue.url,
                MessageBody: JSON.stringify(competitionReq),
            })
        );

        await sqs.send(
            new SendMessageCommand({
                QueueUrl: Resource.MarketAnalysisQueue.url,
                MessageBody: JSON.stringify(marketAnalysisReq),
            })
        );

        await sqs.send(
            new SendMessageCommand({
                QueueUrl: Resource.NewsQueue.url,
                MessageBody: JSON.stringify(newsReq),
            })
        );

    }
    return {
        statusCode: 202,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, queued: true }),
    };

}
