import { callAgent } from "../client.js";
import {
  competingCompaniesSchema,
  type CompetingCompanies,
} from "../schemas.js";

interface CompetitionInput {
  customerDomain: string;
  legalName: string;
  domain: string;
  markets: string[];
  industries: string[];
  revenueInMio: number;
}

export async function generateCompetition(
  input: CompetitionInput,
): Promise<CompetingCompanies> {
  return callAgent<CompetingCompanies>({
    systemPrompt:
      "You are a research assistant to help prepare customer meetings.",
    userPrompt: `Goal:
Find competing companies to: ${input.legalName} and the domain ${input.domain}

Definition of "competitor" (must satisfy all):
1) Operates in the same industry segments: ${input.industries.join(", ")}
2) Competes in the same geographic markets: ${input.markets.join(", ")}
3) Has comparable scale: revenue within ~0.5x to 2x of ${input.revenueInMio} Mio Euros
4) The competitor must be an independent company or a clearly identified business unit if part of a conglomerate.

Process:
A) Identify ${input.legalName}'s core segments, product lines, and main end-markets (use official sources first: company website, annual report, investor presentation, reputable industry profiles).
B) Identify ${input.legalName}'s revenue (most recent year) and currency; if private, use multiple reputable estimates and show the range.
C) Search for competitors in those segments and markets. Prefer sources like annual reports, investor decks, reputable industry publications, market reports, and credible business databases; avoid low-quality listicles.
D) Filter to 8-12 best matches based on criteria above.
E) Provide evidence for each competitor: 2-3 citations that show overlap in products/markets and (approx) revenue scale.

Important rules:
- Set "customerDomain" to "${input.customerDomain}" and "customerLegalName" to "${input.legalName}" in the response.
- Always include the competitor's strongest evidence of direct overlap (specific product lines or business segments).
- Avoid "same broad industry" matches; the overlap must be specific (specific product lines or business segments).
- If revenue is missing, provide an estimate band with at least two independent sources and lower confidence.
- Use the most recent available fiscal year and include the date.`,
    outputSchema: competingCompaniesSchema,
    outputToolName: "save_competition",
    outputToolDescription: "Save the structured competition data",
    useWebSearch: true,
  });
}
