import OpenAI from "openai";
import { chunkTextWink } from "../util/chunker.js"
import Model from "../model.js"
import { generatePrompt } from "../util/openai.js";
import { Resource } from "sst";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchReadableText(source) {
  if (!source || typeof fetch !== "function") {
    throw new Error("Missing source or fetch unavailable");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const normalizedType = contentType.toLowerCase();
    if (
      !normalizedType.includes("text/html") &&
      !normalizedType.includes("application/xhtml+xml")
    ) {
      throw new Error(`Non-HTML content type: ${contentType}`);
    }
    const html = await response.text();
    const stripped = stripHtml(html);
    const decoded = decodeHtmlEntities(stripped);
    return normalizeWhitespace(decoded);
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveNewsText(news) {
  try {
    console.log("Attempting to download ", news.source);
    const text = await fetchReadableText(news.source);
    console.log("Succeeded");
    if (text.length < 200) {
      throw new Error("Readable text too short");
    }
    return text;
  } catch (error) {
    console.log("Falling back to summary");
    return typeof news.summary === "string" ? news.summary : "";
  }
}

const marketAnalysisLensPrompt = {
  input: `
Company: <%= master.legalName %> (<%= master.domain %>)
Context: industries=<%= assessment.industries.value.join(", ") %> markets=<%= assessment.markets.value.join(", ") %> horizon=2-3 years
<% if (news && news.source) { %>Source: <%= news.source %><% } %>
<% if (news && news.date) { %>Date: <%= news.date %><% } %>

Task:
Extract evidence from the passage below that supports a market and customer-demand analysis for the company.
This is not a competitive analysis and must not include solution proposals or initiatives.

Focus on identifying concrete, factual signals (or clearly reasoned inferences) related to:

1) Market context
- Business model and value chain position.
- Primary products, services, applications, and end markets.
- Customer types and routes-to-market.
- Indicators of scale and maturity (sites, capacity, footprint, employee or revenue band).

2) Customer demand patterns
- Price and cost pressure; total cost of ownership expectations.
- Reliability and quality requirements; supply assurance; lead times.
- Need for customization, technical service, and speed of iteration.
- Sustainability expectations (recycled content, CO2 footprint, certifications).
- Compliance and regulatory demands (safety, reporting, traceability).
- Digital expectations (customer portals, order tracking, self-service, EDI/API integration).
- Data transparency needs (product data, SDS, certificates, provenance).

3) Market and industry trends (current to 2-3 years)
- Economic and structural trends affecting the industry.
- Regulatory developments and compliance burdens.
- Supply-chain dynamics, raw-material availability, and volatility.
- Labor availability, energy costs, and cost-structure pressures.
- Sustainability and decarbonization pressures.
- Technology and digital trends that materially impact the industry.

4) Implications for customers
- How identified demand patterns and trends change expectations placed on companies like <%= master.legalName %>.
- Operational, commercial, and organizational implications.

Guidelines:
- Prefer hard facts and verifiable statements; if inferring, make the inference explicit.
- Avoid marketing language and speculation.
- Do not reference competitors or competitive positioning.
- Do not propose initiatives, solutions, or roadmaps.

Evidence passage:
<%+ evidence %>
`
}

export default async function(
  master,
  assessment,
  news
) {

  Model.companyMasterData.validate(master)
  Model.companyAssessment.validate(assessment)
  Model.companyNews.validate(news)

  const text = await resolveNewsText(news);

  console.log("Will chunk: ", text)

  const chunks = chunkTextWink(text, {
    maxWords: 120,
    overlapWords: 25,
  });

  for (const chunk of chunks) {

    const prompt = generatePrompt(marketAnalysisLensPrompt, {
      master,
      assessment,
      news,
      evidence: chunk,
    })

    console.log("Started embedding for chunk", chunk)
    const response = await oc.embeddings.create({
      model: "text-embedding-3-small",
      ...prompt
    })
    console.log("Completed embedding for chunk", chunk)

    const marketAnalysisVector = response.data[0].embedding
    return marketAnalysisVector
  }
}
