import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { getClient } from "../../weaviate.js";
import GenerateCompanyNews, {
  requestValidator,
} from "../../cmd/generateCompanyNews.js";
import Model from "../../model.js";

const model = Model.companyNews;
const sqs = new SQSClient({});

async function hasSuccessfulResponse(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (headResponse.ok) {
      return true;
    }
    const rangeResponse = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Range: "bytes=0-0",
      },
      signal: controller.signal,
    });
    return rangeResponse.ok;
  } catch (error) {
    console.log("Header check failed", url);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const req = requestValidator(record.body);
    const wv = await getClient();
    const items = await GenerateCompanyNews(req);

    for (const item of items ?? []) {
      const existing = await model.fetchObject(wv, item.source);
      if (!existing) {
        await model.insertObject(wv, item);
      } else {
        console.log("Will skip: ", item.source)
      }
      const isAvailable = await hasSuccessfulResponse(item.source);
      if (isAvailable) {
        const downloadReq = {
          domain: item.domain,
          url: item.source,
          fallback: item.summary,
          vectorStore: `news/${item.domain}`,
          type: "news",
        };
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: Resource.DownloadQueue.url,
            MessageBody: JSON.stringify(downloadReq),
          })
        );
      }
    }
  }

  return {
    statusCode: 202,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, queued: true }),
  };
}
