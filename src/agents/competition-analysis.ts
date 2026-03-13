import { callAgent } from "../client.js";
import {
  competitionAnalysisSchema,
  type CompetitionAnalysis,
} from "../schemas.js";

interface CompetitionAnalysisInput {
  customerDomain: string;
  competitorDomain: string;
  customerLegalName: string;
  competitorLegalName: string;
  customerMarketAnalysis: string;
  competitorMarketAnalysis: string;
}

export async function generateCompetitionAnalysis(
  input: CompetitionAnalysisInput,
): Promise<CompetitionAnalysis> {
  // Truncate market analyses to keep prompt manageable
  const maxChars = 3500;
  const customerAnalysis = input.customerMarketAnalysis.substring(0, maxChars);
  const competitorAnalysis = input.competitorMarketAnalysis.substring(
    0,
    maxChars,
  );

  return callAgent<CompetitionAnalysis>({
        systemPrompt: `You are a competitive analyst. Compare the competitor with the customer.
Separate facts from inferred insights.`,
    userPrompt: `Customer:
- Name: ${input.customerLegalName}
- Domain: ${input.customerDomain}
- Market analysis:
${customerAnalysis}

Competitor:
- Name: ${input.competitorLegalName}
- Domain: ${input.competitorDomain}
- Market analysis:
${competitorAnalysis}

Required sections (structured output):
1) Summary (short, 5-8 bullets)
2) Strengths (competitor vs customer; list)
3) Weaknesses (competitor vs customer; list)
4) Market trends impact (list)
5) Customer expectations alignment (list)
6) Sources (title, publisher, url, date)

Output rules:
- Keep analysis under 3500 chars, summary under 1200 chars.
- Set "competitionId" to "${input.customerDomain}|${input.competitorDomain}" in the response.
- Set "customerDomain" to "${input.customerDomain}", "competitorDomain" to "${input.competitorDomain}".
- Set "customerLegalName" to "${input.customerLegalName}", "competitorLegalName" to "${input.competitorLegalName}".`,
    outputSchema: competitionAnalysisSchema,
    outputToolName: "save_competition_analysis",
    outputToolDescription: "Save the structured competition analysis",
    useWebSearch: true,
  });
}
