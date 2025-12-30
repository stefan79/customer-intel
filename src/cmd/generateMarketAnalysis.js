
import { z } from "zod";
import { legalName, domain, industries, markets } from "../model.js"
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
  domain,
  markets,
  industries
}).describe("Request to generate an assesment for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
  instructions: `You are a research assistant to help prepare customer meetings.`,
  input: `Task:
Produce a thorough market and demand analysis for the company "<%= req.legalName%>" (domain: <%= req.domain%>), focusing on the markets the company operates in and what customers in those markets are demanding.

Purpose:
The goal is to understand the customer’s industry environment, structural market dynamics, and evolving customer demands as a foundation for later strategic and competitive analysis.

Analysis scope:
- Geography: <%= req.markets.join(", ") %>
- Time horizon: current state + emerging trends over the next 2–3 years
- Industry context: <%= req.industries.join(", ") %>

Method:
1. Establish the company’s market context:
   - Core business model and value chain position
   - Primary products, services, and end markets
   - Customer types (e.g. industrial customers, OEMs, distributors, consumers)
   - Approximate scale and maturity (use factual data where available, otherwise reasoned estimates)

2. Identify customer demand patterns:
   - What customers in the company’s markets are increasingly demanding
     (e.g. price pressure, reliability, customization, speed, sustainability, compliance, digital interfaces, data transparency)
   - Base this on observable signals such as public statements, product offerings, service descriptions, industry publications, and market reports

3. Analyze market and industry trends:
   - Structural trends affecting the industry (economic, regulatory, supply chain, sustainability, labor, cost structures)
   - Technology and digital trends that are materially impacting the industry
   - Distinguish clearly between:
     • well-established trends
     • emerging or early-stage signals

4. Implications for the company’s customers:
   - Explain how identified trends and demand shifts change expectations placed on companies like "<%= req.legalName %>"
   - Focus on operational, commercial, and organizational implications rather than solutions

Guidelines:
- Prioritize hard facts and verifiable information.
- Where facts are unavailable, use explicit reasoning and clearly state assumptions.
- Avoid speculative, promotional, or solution-oriented language.
- Avoid references to competitors or competitive positioning.
- Do not suggest initiatives, roadmaps, or solutions at this stage.

Citation format requirements:
- For every factual value, attach a human-readable source.
- A source must include: title, publisher, URL, and publication date.
- Do not output tool citation IDs or placeholders.
- If a value is estimated, state the estimation method and cite the benchmark source.

Output:
Provide a structured, analytical narrative focused on market context, customer demand, and industry dynamics.`
}

const model = Model.marketAnalysis;

export default async function (request) {
  const req = requestValidator(request)
  const prompt = generatePrompt(promptTemplate, { req })
  const response = await oc.responses.parse({
    //model: "gpt-5-mini",
    model: "gpt-4o-mini",
    tools: [
      { type: "web_search" },
    ],
    ...prompt,
    ...model.openAIFormat,
  });
  return response.output_parsed
}
