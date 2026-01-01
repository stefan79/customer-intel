
import { z } from "zod";
import { legalName, domain, industries, markets, subjectType } from "../model.js"
import ValidationCreator from "../util/request.js"
import { generatePrompt } from "../util/openai.js";
import Model from "../model.js"
import OpenAI from "openai";
import { Resource } from "sst";


const oc = new OpenAI({
    apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  customerDomain: domain.optional(),
  legalName,
  domain,
  markets,
  industries,
  subjectType: subjectType.optional(),
  vectorStoreId: z.string().min(1),
}).transform((value) => ({
  ...value,
  customerDomain: value.customerDomain ?? value.domain,
  subjectType: value.subjectType ?? "customer",
})).describe("Request to generate an assesment for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
  instructions: `You are a research assistant to help prepare customer meetings. Always pull recent signals from the provided vector store before writing your analysis.`,
  input: `Subject:
- Company: "<%= req.legalName%>" (domain: <%= req.domain%>)
- Customer domain: <%= req.customerDomain %>
- Subject type: <%= req.subjectType %> (<%= req.subjectType === "competitor" ? "analyze as a competitor relative to the customer" : "analyze as the customer" %>)
- Industries: <%= req.industries.join(", ") %>
- Markets: <%= req.markets.join(", ") %>
- Vector store id (news): <%= req.vectorStoreId %>

Critical instructions:
- First, call the file_search tool with the provided vector store id to retrieve recent news snippets. Use up to 10 items, prioritizing recency (prefer the last 90 days) and direct relevance to the subject.
- Treat retrieved news snippets as “Signals”. Keep them separate from verified facts and clearly mark whether each item is factual or an inferred signal.
- You may also use web_search to verify claims and add citations for factual data.

Analysis task:
Produce a thorough market and demand analysis for the subject, focusing on the markets the company operates in and what customers in those markets are demanding over the next 2–3 years.

Method:
1) Signals (news-derived):
   - Summarize up to 10 relevant snippets from file_search.
   - Note publication date and source for each.
   - Clarify whether each snippet is a direct fact or an inferred signal.

2) Market context:
   - Core business model and value chain position
   - Primary products, services, and end markets
   - Customer types (e.g. industrial customers, OEMs, distributors, consumers)
   - Approximate scale and maturity (use factual data where available, otherwise reasoned estimates)

3) Customer demand patterns:
   - What customers in the company’s markets are increasingly demanding (price, reliability, customization, speed, sustainability, compliance, digital interfaces, data transparency, etc.)
   - Base this on observable signals such as public statements, product offerings, service descriptions, industry publications, and market reports

4) Market and industry trends:
   - Structural trends affecting the industry (economic, regulatory, supply chain, sustainability, labor, cost structures)
   - Technology and digital trends materially impacting the industry
   - Distinguish clearly between well-established trends and emerging or early-stage signals

5) Implications:
   - Explain how identified trends and demand shifts change expectations placed on companies like "<%= req.legalName %>"
   - Focus on operational, commercial, and organizational implications rather than solutions

Guidelines:
- Prioritize hard facts and verifiable information with citations (title, publisher, URL, publication date). Do not output tool citation IDs.
- Where facts are unavailable, use explicit reasoning and clearly state assumptions.
- Avoid speculative, promotional, or solution-oriented language.
- Maintain a clear separation between Signals (news-derived), validated facts, and inferred implications.
- Set "domain" to "<%= req.domain %>", "customerDomain" to "<%= req.customerDomain %>", "subjectType" to "<%= req.subjectType %>", and "vectorStoreId" to "<%= req.vectorStoreId %>" in the final structured response.`
}

const model = Model.marketAnalysis;

export default async function (request) {
  const req = requestValidator(request)
  const prompt = generatePrompt(promptTemplate, { req })
  const response = await oc.responses.parse({
    //model: "gpt-5-mini",
    model: "gpt-4o-mini",
    tools: [
      {
        type: "file_search",
        vector_store_ids: [req.vectorStoreId],
      },
      { type: "web_search" },
    ],
    ...prompt,
    ...model.openAIFormat,
  });
  const analysis = response.output_parsed
  return {
    ...analysis,
    domain: req.domain,
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    vectorStoreId: req.vectorStoreId,
  }
}
