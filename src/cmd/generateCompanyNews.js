import { z } from "zod";
import { legalName, domain } from "../model.js"
import ValidationCreator from "../util/request.js"
import { generatePrompt } from "../util/openai.js";
import Model from "../model.js"
import OpenAI from "openai";
import { Resource } from "sst";
import { zodTextFormat } from "openai/helpers/zod";

const oc = new OpenAI({
    apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  legalCompanyName: legalName,
  domain
}).describe("Request to generate company news for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
  instructions: `You are a research assistant to help prepare customer meetings.`,
  input: `Task:
Search the public internet for news about the company "<%= req.legalCompanyName %>" (domain: <%= req.domain %>).

Focus areas:
- Organizational changes (leadership, restructuring, M&A, hiring/firing initiatives)
- Announcements of new products, goods, or services
- Retrospectives or post-mortems on major initiatives
- Roadmap or strategic announcements
- IT-related updates (platform changes, major system rollouts, cloud migration, cybersecurity events)

Source rules:
- Use public, non-paywalled sources only (company website, press releases, blogs, reputable media).
- Avoid low-quality listicles or scraped aggregators.

Output rules:
- Return up to 20 items
- Only include items with a clear publication date.
- Do not include duplicates or multiple entries for the same source URL.
- Set "domain" to "<%= req.domain %>" for every item.
- Return an array of items.
- Return structured data only; no prose or explanations.
- Keep the JSON response small: limit each summary to <= 600 characters and hard cap at 12 items.
- Do not include any extra keys beyond the schema.`
}

const model = Model.companyNews;
const listFormat = {
  text: {
    format: zodTextFormat(z.object({
      list: z.array(model.zodSchema), 
    }), "CompanyNewsList"),
  },
};

export default async function (request) {
  const req = requestValidator(request)
  const prompt = generatePrompt(promptTemplate, { req })
  const response = await oc.responses.parse({
    model: "gpt-4o-mini",
    tools: [
      { type: "web_search" },
    ],
    ...prompt,
    ...listFormat,
  });
  return response.output_parsed.list
}
