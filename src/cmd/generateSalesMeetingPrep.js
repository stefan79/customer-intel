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
  companyProfile: z.record(z.any()).describe("Master data profile for the customer"),
  itStrategy: Model.itStrategy.zodSchema,
  serviceMatching: Model.serviceMatching.zodSchema,
}).transform((value) => ({
  ...value,
  subjectType: value.subjectType ?? "customer",
})).describe("Request to prepare a sales meeting briefing");

export const requestValidator = ValidationCreator(requestSchema);

const promptTemplate = {
  instructions: `You are a senior sales engineer preparing an executive meeting. You seek insight and trust, not closing.`,
  input: `Context (frozen):
- Customer: <%= req.customerLegalName %> (<%= req.customerDomain %>) subjectType=<%= req.subjectType %>
- Company profile: <%= JSON.stringify(req.companyProfile, null, 2) %>
- IT strategies (approved): <%= JSON.stringify(req.itStrategy.strategies, null, 2) %>
- Service matches: <%= JSON.stringify(req.serviceMatching.matches, null, 2) %>

Task:
- Prepare the meeting briefing with executive context, strategic hypotheses, smart questions (each tied to a strategy), strategic impulses (non-salesy), and low-risk POC ideas (objective, scope, success criteria).

Constraints:
- No generic sales language.
- Do not introduce services not present in the service matching output.
- Prioritize the 3-5 most relevant strategies for the meeting.
- Every question must cite the related strategy id or name.
- POCs must be exploratory and low-risk.

Output format (JSON):
- id = "<%= req.customerDomain %>"
- customerDomain = "<%= req.customerDomain %>"
- subjectType = "<%= req.subjectType %>"
- customerLegalName = "<%= req.customerLegalName %>"
- itStrategyId = "<%= req.itStrategy.id %>"
- serviceMatchingId = "<%= req.serviceMatching.id %>"
- executiveBriefing
- strategicHypotheses
- questionsToAsk
- strategicImpulses
- pocIdeas [{ objective, scope, successCriteria }]`,
};

const model = Model.salesMeetingPrep;

export default async function generateSalesMeetingPrep(request) {
  const req = requestValidator(request);
  const prompt = generatePrompt(promptTemplate, { req });
  const response = await oc.responses.parse({
    model: "gpt-4.1-mini",
    ...prompt,
    ...model.openAIFormat,
  });
  const prep = response.output_parsed;
  return {
    ...prep,
    id: req.customerDomain,
    customerDomain: req.customerDomain,
    subjectType: req.subjectType,
    customerLegalName: req.customerLegalName,
    itStrategyId: req.itStrategy.id,
    serviceMatchingId: req.serviceMatching.id,
  };
}
