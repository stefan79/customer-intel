import { callAgent } from "../client.js";
import {
  marketAnalysisSchema,
  type MarketAnalysis,
  type CompanyNews,
} from "../schemas.js";

interface MarketAnalysisInput {
  domain: string;
  customerDomain: string;
  legalName: string;
  subjectType: "customer" | "competitor";
  industries: string[];
  markets: string[];
  newsItems: CompanyNews[];
}

export async function generateMarketAnalysis(
  input: MarketAnalysisInput,
): Promise<MarketAnalysis> {
  // Prepare news context - truncate each summary, cap at 12 items
  const newsContext = input.newsItems
    .slice(0, 12)
    .map(
      (n, i) =>
        `[${i + 1}] ${n.date} | ${n.source}\n${n.summary.substring(0, 600)}`,
    )
    .join("\n\n");

  return callAgent<MarketAnalysis>({
        systemPrompt:
      "You are a research assistant to help prepare customer meetings. Use the provided news signals as context for your analysis.",
    userPrompt: `Subject:
- Company: "${input.legalName}" (domain: ${input.domain})
- Customer domain: ${input.customerDomain}
- Subject type: ${input.subjectType} (${input.subjectType === "competitor" ? "analyze as a competitor relative to the customer" : "analyze as the customer"})
- Industries: ${input.industries.join(", ")}
- Markets: ${input.markets.join(", ")}

Recent News Signals:
${newsContext || "(No news signals available)"}

Analysis task:
Produce a thorough market and demand analysis for the subject, focusing on the markets the company operates in and what customers in those markets are demanding over the next 2-3 years.

Method:
1) Signals (news-derived):
   - Summarize up to 10 relevant snippets from the news signals above.
   - Note publication date and source for each.
   - Clarify whether each snippet is a direct fact or an inferred signal.

2) Market context:
   - Core business model and value chain position
   - Primary products, services, and end markets
   - Customer types (e.g. industrial customers, OEMs, distributors, consumers)
   - Approximate scale and maturity (use factual data where available, otherwise reasoned estimates)

3) Customer demand patterns:
   - What customers in the company's markets are increasingly demanding
   - Base this on observable signals such as public statements, product offerings, service descriptions, industry publications, and market reports

4) Market and industry trends:
   - Structural trends affecting the industry (economic, regulatory, supply chain, sustainability, labor, cost structures)
   - Technology and digital trends materially impacting the industry
   - Distinguish clearly between well-established trends and emerging or early-stage signals

5) Implications:
   - Explain how identified trends and demand shifts change expectations placed on companies like "${input.legalName}"
   - Focus on operational, commercial, and organizational implications rather than solutions

Guidelines:
- Prioritize hard facts and verifiable information with citations (title, publisher, URL, publication date).
- Where facts are unavailable, use explicit reasoning and clearly state assumptions.
- Avoid speculative, promotional, or solution-oriented language.
- Maintain a clear separation between Signals (news-derived), validated facts, and inferred implications.
- Set "domain" to "${input.domain}", "customerDomain" to "${input.customerDomain}", and "subjectType" to "${input.subjectType}" in the final response.
- Keep the analysis text under 3500 characters.`,
    outputSchema: marketAnalysisSchema,
    outputToolName: "save_market_analysis",
    outputToolDescription: "Save the structured market analysis",
    useWebSearch: true,
  });
}
