import { z } from "zod";
import OpenAI from "openai";
import { Resource } from "sst";
import { domain, legalName, subjectType } from "../model.js";
import ValidationCreator from "../util/request.js";
import { generatePrompt } from "../util/openai.js";
import Model from "../model.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const evidenceSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  text: z.string().min(1),
});

const competitionSchema = z.object({
  competitorDomain: domain,
  competitorLegalName: legalName,
  analysis: z.string().min(1),
  summary: z.string().min(1).optional(),
});

const requestSchema = z.object({
  customerDomain: domain,
  subjectType: subjectType.optional(),
  customerLegalName: legalName,
  companyProfile: z.record(z.any()).describe("Master data profile for the customer"),
  companyMarketAnalysis: z
    .object({
      analysis: z.string().min(1),
    })
    .passthrough()
    .describe("Market analysis for the customer"),
  competitionAnalysis: z.array(competitionSchema).default([]),
  evidence: z.array(evidenceSchema).min(1),
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
})).describe("Request to generate IT strategy without selling");

export const requestValidator = ValidationCreator(requestSchema);

const promptTemplate = {
  instructions: `You are a senior enterprise IT strategist advising the executive board. You do NOT sell services and you do NOT propose vendors.`,
  input: `Context (frozen):
- Customer: <%= req.customerLegalName %> (<%= req.customerDomain %>) subjectType=<%= req.subjectType %>
- Company profile: <%= JSON.stringify(req.companyProfile, null, 2) %>
- Market analysis (customer): <%= req.companyMarketAnalysis.analysis %>
- Competition analysis (summaries): <%= JSON.stringify(req.competitionAnalysis, null, 2) %>
- Evidence excerpts (id + source + text): <%= JSON.stringify(req.evidence, null, 2) %>

Task:
- Derive business-driven IT strategies that strengthen competitive advantages, compensate structural weaknesses, and enable new niches.
- Each strategy must cite at least one evidence id from the provided excerpts.

Constraints:
- Absolutely no vendors, products, or selling language.
- Strategies must stay business-driven and traceable to evidence.
- Avoid buzzwords and generic statements.
- Keep time horizon as one of: short, mid, long.

Output format (JSON):
- id = "<%= req.customerDomain %>"
- customerDomain = "<%= req.customerDomain %>"
- subjectType = "<%= req.subjectType %>"
- customerLegalName = "<%= req.customerLegalName %>"
- strategies: array of { id, name, intent, competitiveRationale, businessCapabilityImpact, itCapabilityImplications, riskIfNotPursued, timeHorizon, evidenceIds }
- strengthAmplification: strategy ids or names
- weaknessCompensation: strategy ids or names
- newNicheDifferentiation: strategy ids or names
- sources: citations used`,
};

const model = Model.itStrategy;

export default async function generateITStrategy(request) {
  const req = requestValidator(request);
  const prompt = generatePrompt(promptTemplate, { req });
  const response = await oc.responses.parse({
    model: "gpt-4.1",
    tools: [{ type: "web_search" }],
    ...prompt,
    ...model.openAIFormat,
  });
  const strategy = response.output_parsed;
  return {
    ...strategy,
    id: req.customerDomain,
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    customerLegalName: req.customerLegalName,
    sources: strategy.sources ?? [],
  };
}
