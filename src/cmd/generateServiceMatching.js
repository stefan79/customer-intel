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

const requestSchema = z.object({
  customerDomain: domain,
  subjectType: subjectType.optional(),
  customerLegalName: legalName,
  itStrategy: Model.itStrategy.zodSchema,
  companyProfile: z.record(z.any()).describe("Master data profile for the customer"),
  vendorCatalogVectorStoreId: z.string().min(1),
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
})).describe("Request to map IT strategies to vendor services");

export const requestValidator = ValidationCreator(requestSchema);

const promptTemplate = {
  instructions: `You are a solution architect at an IT service provider. You align client IT strategies with existing services only.`,
  input: `Context (frozen):
- Customer: <%= req.customerLegalName %> (<%= req.customerDomain %>) subjectType=<%= req.subjectType %>
- Company profile: <%= JSON.stringify(req.companyProfile, null, 2) %>
- IT strategies: <%= JSON.stringify(req.itStrategy.strategies, null, 2) %>
- Vendor catalog vector store id: <%= req.vendorCatalogVectorStoreId %>

Task:
- For each IT strategy, identify supporting services from the vendor catalog (via file_search).
- Explain the value contribution briefly.
- Provide entry-level engagement ideas.
- Call out gaps explicitly when no service matches.

Constraints:
- Use file_search with vector store id "<%= req.vendorCatalogVectorStoreId %>" to retrieve vendor services.
- Do NOT invent services. Do NOT use web_search.
- Keep rationales short and concrete.
- If no match exists, set supportingServices to [] and gaps to ["no matching service"].

Output format (JSON):
- id = "<%= req.customerDomain %>"
- customerDomain = "<%= req.customerDomain %>"
- subjectType = "<%= req.subjectType %>"
- customerLegalName = "<%= req.customerLegalName %>"
- itStrategyId = "<%= req.itStrategy.id %>"
- matches: array of { strategyName, supportingServices, valueContribution, entryLevelEngagementIdeas, gaps }`,
};

const model = Model.serviceMatching;

export default async function generateServiceMatching(request) {
  const req = requestValidator(request);
  const prompt = generatePrompt(promptTemplate, { req });
  const response = await oc.responses.parse({
    model: "gpt-4.1-mini",
    tools: [
      {
        type: "file_search",
        vector_store_ids: [req.vendorCatalogVectorStoreId],
      },
    ],
    ...prompt,
    ...model.openAIFormat,
  });
  const matching = response.output_parsed;
  return {
    ...matching,
    id: req.customerDomain,
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    customerLegalName: req.customerLegalName,
    itStrategyId: req.itStrategy.id,
  };
}
