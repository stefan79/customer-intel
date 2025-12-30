
import { z } from "zod";
import { legalName, domain } from "../model.js"
import ValidationCreator from "../util/request.js"
import { generatePrompt } from "../util/openai.js";
import Model from "../model.js"
import OpenAI from "openai";
import { Resource } from "sst";


const oc = new OpenAI({
    apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  legalName,
  domain
}).describe("Request to generate an assesment for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
  instructions: `You are a research assistant to help prepare customer meetings.`,
  input: `Task:
Conduct research on the company: <%= req.legalName %> with the domain <%= req.domain %>.
Prioritize hard, verifiable facts; where facts are unavailable, derive reasoned estimates using current (2025) industry standards and benchmarks.

Objectives:
- Retrieve accurate, up-to-date information from authoritative public sources.
- Do not rely on sources published before 2025 unless they are the only available reference for a foundational fact (e.g. founding year); explicitly flag such cases.
- Strongly prefer sources from 2025 or later.
- Prefer primary sources (official company website, recent annual reports, filings, press releases, official registers).
- Use secondary sources (reputable business databases, major financial or industry publications) only to confirm or complement primary data.
- Resolve conflicting information by selecting the most reliable and recent source and briefly explaining the choice.
- Keep results factual, concise, and analytical; avoid marketing language.

Method:
1. Use the provided domain to identify and confirm the company’s official web presence; disambiguate from similarly named entities or subsidiaries.
2. Collect hard facts first, including (where available):
   - legal entity name and corporate structure
   - headquarters and key locations
   - ownership, parent or holding company
   - core products, services, and industry segments
   - primary markets and geographies
   - employee count and revenue (most recent available year)
3. Review recent content on the company’s homepage, press releases, and news section to infer indicators of digital maturity (e.g. digital products, platforms, data, automation, AI, customer portals).
4. For attributes that are typically not disclosed publicly (e.g. number of IT employees, IT spend):
   - Do not return “unknown” unless estimation is impossible.
   - Derive a reasoned estimate using current benchmarks, ratios, or norms specific to the custoemrs industry and region (e.g. IT staff as % of total workforce, IT spend as % of revenue for the relevant industry and company size).
   - Clearly label such values as estimates and explain the basis of the estimation.
5. Cross-check key facts with at least one independent, reputable source whenever possible.
6. If multiple plausible values or interpretations exist, list the alternatives and explain why one is most likely.

Output:
- Return the researched company information as structured factual content only.
- Do not invent values arbitrarily.
- Avoid using “unknown” as a source; if a value is estimated, provide the best defensible estimate along with its rationale and confidence.
- Do not include schema descriptions or explanations of formatting.`
}

const model = Model.companyAssessment;

export default async function (request) {
  const req = requestValidator(request)
  const prompt = generatePrompt(promptTemplate, { req })
  const response = await oc.responses.parse({
    model: "gpt-5-mini",
    tools: [
      { type: "web_search" },
    ],
    ...prompt,
    ...model.openAIFormat,
  });
  return response.output_parsed
}

