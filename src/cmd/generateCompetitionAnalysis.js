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
const MAX_MARKET_ANALYSIS_CHARS = 3500;

function truncateText(text, maxChars) {
  if (typeof text !== "string") {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}...`;
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Response did not contain a JSON object.");
  }
  return text.slice(start, end + 1);
}

function escapeControlCharsInJsonStrings(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        result += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        result += char;
        inString = false;
        continue;
      }
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }
      result += char;
      continue;
    }

    if (char === "\"") {
      inString = true;
    }
    result += char;
  }

  return result;
}

function parseJsonWithEscapedStrings(raw, schema) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("OpenAI response did not include any JSON content.");
  }
  const jsonPayload = extractJsonObject(trimmed);
  const escaped = escapeControlCharsInJsonStrings(jsonPayload);
  return schema.parse(JSON.parse(escaped));
}

export default async function generateCompetitionAnalysis(request) {
  const raw = requestValidator(request);
  const req = {
    ...raw,
    customerMarketAnalysis: truncateText(raw.customerMarketAnalysis, MAX_MARKET_ANALYSIS_CHARS),
    competitorMarketAnalysis: truncateText(raw.competitorMarketAnalysis, MAX_MARKET_ANALYSIS_CHARS),
  };
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
    const shouldRetry =
      message.includes("Unterminated string in JSON") ||
      message.includes("Unexpected token") ||
      message.includes("JSON");
    if (!shouldRetry) {
      throw error;
    }
    const retryPrompt = {
      ...prompt,
      instructions: `${prompt.instructions}\n\n${PARSE_RETRY_INSTRUCTIONS}`,
    };
    const response = await oc.responses.create({
      ...baseRequest,
      ...retryPrompt,
    });
    parsed = parseJsonWithEscapedStrings(response.output_text, model.zodSchema);
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
