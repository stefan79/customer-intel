
import { z } from "zod";
import {legalName, domain} from "../model.js"
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
}).describe("Request to generate master data for a company");

export const requestValidator = ValidationCreator(requestSchema)

const promptTemplate = {
    instructions: `You are a research assistant to help prepare customer meetings.`,
    input: `
        Task:
        Look up and verify master data for the company: <%= req.legalName%> and the domain <%= req.domain%>.

        Objectives:
        - Retrieve accurate, up-to-date master data from authoritative public sources.
        - Prefer primary sources (official company website, annual report, filings, press releases).
        - Use secondary sources (business databases, reputable news) only to confirm or fill gaps.
        - Resolve conflicting information by citing the most reliable source and explaining the choice.

         Method:
        1. Identify the company’s official web presence via the given domain
        2. Cross-check key facts with at least one independent, reputable source.
        3. If data is missing or uncertain, provide best estimates and note uncertainty.
        4. Avoid speculative or promotional language.

        Output:
        - Return the collected master data as structured factual content only.
        - Do not invent values.
        - Do not include schema descriptions or explanations of formatting.`
}

const model = Model.companyMasterData;

export default async function(request) {
    const req = requestValidator(request)
    const prompt = generatePrompt(promptTemplate, {req})
    const response = await oc.responses.parse({
      model: "gpt-4o-mini",
      tools: [
        { type: "web_search" },
      ],
      ...prompt,
      ...model.openAIFormat,
    });
    return response.output_parsed
}

