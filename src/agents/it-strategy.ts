import { callAgent } from "../client.js";
import {
  itStrategySchema,
  type ITStrategy,
  type CompanyMasterData,
  type MarketAnalysis,
  type CompetitionAnalysis,
} from "../schemas.js";

interface EvidenceItem {
  id: string;
  source: string;
  text: string;
}

interface ITStrategyInput {
  customerDomain: string;
  customerLegalName: string;
  subjectType: "customer" | "competitor";
  companyProfile: CompanyMasterData;
  companyMarketAnalysis: MarketAnalysis;
  competitionAnalyses: CompetitionAnalysis[];
  evidence: EvidenceItem[];
}

export async function generateITStrategy(
  input: ITStrategyInput,
): Promise<ITStrategy> {
  // Build competition summary for context
  const competitionSummaries = input.competitionAnalyses.map((ca) => ({
    competitor: ca.competitorLegalName,
    summary: ca.summary.substring(0, 800),
    strengths: ca.strengths,
    weaknesses: ca.weaknesses,
  }));

  // Cap evidence to 12 items, truncated
  const evidenceContext = input.evidence.slice(0, 12).map((e) => ({
    id: e.id,
    source: e.source,
    text: e.text.substring(0, 800),
  }));

  return callAgent<ITStrategy>({
    reasoning: true,
    systemPrompt:
      "You are a senior enterprise IT strategist advising the executive board. You do NOT sell services and you do NOT propose vendors.",
    userPrompt: `Context (frozen):
- Customer: ${input.customerLegalName} (${input.customerDomain}) subjectType=${input.subjectType}
- Company profile: ${JSON.stringify(input.companyProfile, null, 2)}
- Market analysis (customer): ${input.companyMarketAnalysis.analysis.substring(0, 3500)}
- Competition analysis (summaries): ${JSON.stringify(competitionSummaries, null, 2)}
- Evidence excerpts (id + source + text): ${JSON.stringify(evidenceContext, null, 2)}

Task:
- Derive business-driven IT strategies that strengthen competitive advantages, compensate structural weaknesses, and enable new niches.
- Each strategy must cite at least one evidence id from the provided excerpts.

Constraints:
- Absolutely no vendors, products, or selling language.
- Strategies must stay business-driven and traceable to evidence.
- Avoid buzzwords and generic statements.
- Keep time horizon as one of: short, mid, long.

Output format:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- strategies: array of { id, name, intent, competitiveRationale, businessCapabilityImpact, itCapabilityImplications, riskIfNotPursued, timeHorizon, evidenceIds }
- strengthAmplification: strategy ids or names
- weaknessCompensation: strategy ids or names
- newNicheDifferentiation: strategy ids or names
- sources: citations used`,
    outputSchema: itStrategySchema,
    outputToolName: "save_it_strategy",
    outputToolDescription:
      "Save the structured IT strategy document",
    useWebSearch: true,
    maxTokens: 16000,
  });
}
