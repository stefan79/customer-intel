import { z } from "zod";
import OpenAI from "openai";
import { Resource } from "sst";
import ValidationCreator from "../util/request.js";
import { domain, legalName } from "../model.js";
import { generatePrompt } from "../util/openai.js";
import Model from "../model.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  customerDomain: domain,
  competitorDomain: domain,
  customerLegalName: legalName,
  competitorLegalName: legalName,
  customerMarketAnalysis: z.string().min(1),
  competitorMarketAnalysis: z.string().min(1),
  customerVectorStoreId: z.string().min(1),
  competitorVectorStoreId: z.string().min(1),
});

export const requestValidator = ValidationCreator(requestSchema);

const promptTemplate = {
  instructions: `
You are a competitive analyst. Compare the competitor with the customer.

Use file_search for news signals from both vector stores before writing.
Use web_search to validate facts and gather missing citations.
Use Weaviate evidence (market analysis embeddings + retrieved context) to ground the comparison.
Separate facts from inferred insights.`,
  input: `
Customer:
- Name: <%= req.customerLegalName %>
- Domain: <%= req.customerDomain %>
- Market analysis: <%= req.customerMarketAnalysis %>

Competitor:
- Name: <%= req.competitorLegalName %>
- Domain: <%= req.competitorDomain %>
- Market analysis: <%= req.competitorMarketAnalysis %>

Required sections (structured output):
1) Summary (short, 5-8 bullets)
2) Strengths (competitor vs customer; list)
3) Weaknesses (competitor vs customer; list)
4) Niche positioning comparison (short narrative)
5) Market trends impact (list + short narrative)
6) Customer expectations alignment (list + short narrative)
7) Sources (title, publisher, url, date)

Output rules:
- Return JSON only matching the schema.
- Escape newlines/tabs in strings.
- Keep analysis under 3500 chars, summary under 1200 chars.
- Set "competitionId" to "<%= req.customerDomain %>|<%= req.competitorDomain %>" in the response.
- Include competitorDomain in the output.`,
};

const model = Model.competitionAnalysis;
const PARSE_RETRY_INSTRUCTIONS =
  "Return a single valid JSON object only. Ensure all strings are properly escaped and do not include raw newlines.";

export default async function generateCompetitionAnalysis(request) {
  const req = requestValidator(request);
  const prompt = generatePrompt(promptTemplate, { req });

  const baseRequest = {
    model: "gpt-4o-mini",
    tools: [
      {
        type: "file_search",
        vector_store_ids: [req.customerVectorStoreId, req.competitorVectorStoreId],
      },
      { type: "web_search" },
    ],
    ...prompt,
    ...model.openAIFormat,
  };

  let parsed;
  try {
    const response = await oc.responses.parse(baseRequest);
    parsed = response.output_parsed;
  } catch (error) {
    const message = error?.message ?? "";
    const shouldRetry = message.includes("Unterminated string in JSON");
    if (!shouldRetry) {
      throw error;
    }
    const retryPrompt = {
      ...prompt,
      instructions: `${prompt.instructions}\n\n${PARSE_RETRY_INSTRUCTIONS}`,
    };
    const response = await oc.responses.parse({
      ...baseRequest,
      ...retryPrompt,
    });
    parsed = response.output_parsed;
  }
  return {
    ...parsed,
    competitionId: `${req.customerDomain}|${req.competitorDomain}`,
    customerDomain: req.customerDomain,
    competitorDomain: req.competitorDomain,
    customerLegalName: req.customerLegalName,
    competitorLegalName: req.competitorLegalName,
  };
}
