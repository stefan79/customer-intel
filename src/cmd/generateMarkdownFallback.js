import { z } from "zod";
import ValidationCreator from "../util/request.js";
import { generatePrompt } from "../util/openai.js";
import OpenAI from "openai";
import { Resource } from "sst";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  domain: z.string().min(1),
  type: z.string().min(1),
  fallback: z.string().min(1),
  url: z.string().min(1).optional(),
}).describe("Request to expand a fallback summary into markdown");

export const requestValidator = ValidationCreator(requestSchema);

const promptTemplate = {
  instructions: `You are a research assistant preparing a file for a vector store.`,
  input: `Task:
Expand the summary below into a more detailed markdown brief.

Context:
- Domain: <%= req.domain %>
- Type: <%= req.type %>
<% if (req.url) { %>- Source URL (unavailable): <%= req.url %><% } %>

Summary to expand:
<%= req.fallback %>

Rules:
- Output markdown only.
- Do not invent facts that are not implied by the summary.
- If details are missing, state them as unknown.
- Keep the content concise but richer than the summary.`,
};

export default async function generateMarkdownFallback(request) {
  const req = requestValidator(request);
  const prompt = generatePrompt(promptTemplate, { req });
  const response = await oc.responses.create({
    model: "gpt-4o-mini",
    ...prompt,
  });

  const markdown = response.output_text?.trim();
  if (!markdown) {
    throw new Error("Fallback markdown generation returned empty output.");
  }

  return markdown;
}
