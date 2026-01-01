
import { z } from "zod";
import { legalName, domain, subjectType } from "../model.js"
import ValidationCreator from "../util/request.js"
import { generatePrompt } from "../util/openai.js";
import Model, {revenueInMio, industries, markets} from "../model.js"
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
  revenueInMio,
  subjectType: subjectType.optional(),
}).transform((value) => ({
  ...value,
  customerDomain: value.customerDomain ?? value.domain,
  subjectType: value.subjectType ?? "customer",
})).describe("Request to generate an competetiion list for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
    instructions: `You are a research assistant to help prepare customer meetings.`,
    input: `
        Goal:
        Find competing companies to: <%= req.legalName %> and the domain <%= req.domain %>

        Definition of “competitor” (must satisfy all):
        1) Operates in the same industry segments: <%= req.industries.join(", ")%>
        2) Competes in the same geographic markets:  <%= req.markets.join(", ")%>
        3) Has comparable scale: revenue within ~0.5x to 2x of <%= req.revenueInMio%> Mio Euros
        4) The competitor must be an independent company or a clearly identified business unit if part of a conglomerate.

        Process:
        A) Identify <% req.legalName %>’s core segments, product lines, and main end-markets (use official sources first: company website, annual report, investor presentation, reputable industry profiles).
        B) Identify <% req.legalName %>’s revenue (most recent year) and currency; if private, use multiple reputable estimates and show the range.
        C) Search for competitors in those segments and markets. Prefer sources like annual reports, investor decks, reputable industry publications, market reports, and credible business databases; avoid low-quality listicles.
        D) Filter to 8–12 best matches based on criteria above.
        E) Provide evidence for each competitor: 2–3 citations that show overlap in products/markets and (approx) revenue scale.

        Important rules:
        - Set "customerDomain" to "<%= req.customerDomain %>" and "customerLegalName" to "<%= req.legalName %>" in the response.
        - Always include the competitor’s strongest evidence of direct overlap (specific product lines or business segments).
        - Avoid “same broad industry” matches; the overlap must be specific (specific product lines or business segments).
        - If revenue is missing, provide an estimate band with at least two independent sources and lower confidence.
        - Use the most recent available fiscal year and include the date.
`
}

const model = Model.competingCompanies;

export default async function (request) {
  const req = requestValidator(request)
  const prompt = generatePrompt(promptTemplate, { req })
  const response = await oc.responses.parse({
    model: "gpt-4o-mini",
    tools: [
      { type: "web_search" },
    ],
      ...prompt,
      ...model.openAIFormat,
    });
  const competition = response.output_parsed
  return {
    ...competition,
    customerDomain: req.customerDomain,
    customerLegalName: req.legalName,
  }
}
