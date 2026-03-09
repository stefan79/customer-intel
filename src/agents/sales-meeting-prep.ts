import { z } from "zod";
import { callAgent } from "../client.js";
import {
  salesMeetingPrepSchema,
  type SalesMeetingPrep,
  type ITStrategy,
  type ServiceMatching,
  type CompanyMasterData,
  type CompanyAssessment,
  type CompetitionAnalysis,
} from "../schemas.js";

interface SalesMeetingPrepInput {
  customerDomain: string;
  customerLegalName: string;
  subjectType: "customer" | "competitor";
  companyProfile: CompanyMasterData;
  assessment: CompanyAssessment;
  itStrategy: ITStrategy;
  serviceMatching: ServiceMatching;
  competitionAnalyses: CompetitionAnalysis[];
  customerMarketAnalysis: string;
}

// ── Scoring schemas ──

const scoredPocSchema = z.object({
  title: z.string().min(1).describe("POC title being scored"),
  noveltyVerdict: z
    .enum(["KEEP", "SHARPEN", "REPLACE"])
    .describe(
      "KEEP = novel, SHARPEN = interesting but generic, REPLACE = commodity",
    ),
  noveltyReasoning: z
    .string()
    .min(1)
    .describe("Why this novelty verdict — reference baseline and competitive context"),
  bottomLineStrength: z
    .number()
    .min(1)
    .max(5)
    .describe(
      "How compelling is the bottom line? 5 = transformative multi-stakeholder value, 1 = narrow/incremental benefit",
    ),
  successFactorUniqueness: z
    .number()
    .min(1)
    .max(5)
    .describe(
      "How unique and well-backed are the success factors? 5 = differentiated metrics with concrete mechanisms, 1 = generic KPIs anyone could list",
    ),
  compositeScore: z
    .number()
    .min(1)
    .max(10)
    .describe(
      "Overall score (1-10) combining novelty, bottom-line strength, and success factor quality. Used for ranking.",
    ),
});

const scoredImpulseSchema = z.object({
  title: z.string().min(1).describe("Impulse title being scored"),
  noveltyVerdict: z
    .enum(["KEEP", "SHARPEN", "REPLACE"])
    .describe(
      "KEEP = novel, SHARPEN = interesting but generic, REPLACE = commodity",
    ),
  noveltyReasoning: z
    .string()
    .min(1)
    .describe("Why this novelty verdict"),
});

const scoringResultSchema = z.object({
  pocScores: z
    .array(scoredPocSchema)
    .describe("Score for each POC, used for ranking and selection"),
  impulseScores: z
    .array(scoredImpulseSchema)
    .describe("Novelty verdict for each impulse"),
  recommendedPocTitles: z
    .array(z.string().min(1))
    .describe(
      "Titles of the top 3-5 POCs to keep, ranked by composite score. Drop the weakest ones.",
    ),
});

function buildCompetitionHighlights(analyses: CompetitionAnalysis[]): string {
  return analyses
    .map(
      (ca) =>
        `**${ca.competitorLegalName}** (${ca.competitorDomain})
  Strengths vs customer: ${ca.strengths.slice(0, 4).join("; ")}
  Weaknesses vs customer: ${ca.weaknesses.slice(0, 4).join("; ")}
  Market trends: ${ca.marketTrends.slice(0, 3).join("; ")}`,
    )
    .join("\n\n");
}

function buildAssessmentSummary(a: CompanyAssessment): string {
  return `Revenue: ~${a.revenueInMio.value}M EUR | IT Spend: ~${a.itSpendInMio.value}M EUR | Employees: ~${a.numberOfEmployees.value} (IT: ~${a.numberOfITEmployees.value})
Digital Maturity: ${a.digitalMaturity.value} | Industries: ${a.industries.value.join(", ")} | Markets: ${a.markets.value.join(", ")}
Constraints: ${a.industrySpecificConstraints.value.length > 0 ? a.industrySpecificConstraints.value.join(", ") : "none identified"}`;
}

function log(step: string, message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [sales-meeting-prep] ${step}: ${message}`);
}

export async function generateSalesMeetingPrep(
  input: SalesMeetingPrepInput,
): Promise<SalesMeetingPrep> {
  const assessmentSummary = buildAssessmentSummary(input.assessment);
  const competitionHighlights = buildCompetitionHighlights(
    input.competitionAnalyses,
  );

  // ── Phase 1: Overgenerate with maturity gating ──
  log("phase-1", "Generating briefing with 8-10 POC candidates...");

  const initial = await callAgent<SalesMeetingPrep>({
    systemPrompt: `You are a senior sales engineer preparing an executive meeting. You seek insight and trust, not closing.

CRITICAL RULE: You must think like a domain expert who has done their homework, not a consultant recycling boilerplate.

Before generating ANY impulses or POC ideas, you MUST first produce a capabilityBaseline: an honest assessment of what the customer LIKELY ALREADY HAS in production given their size, digital maturity, industry, and competitive position. This is the floor. Everything you suggest must go ABOVE this floor.

The golden test for every impulse and POC: "Would a senior technology leader at this company say 'we already do that'?" If yes, it is worthless — go deeper, go cross-domain, go to the intersection of two strategy themes, or find a specific competitive gap they haven't closed.

IMPORTANT: Generate 8-10 POC ideas (not 3-5). We will score and filter them later. Cast a wide net — include cross-domain intersections, competitive gap exploits, and provocative ideas that would make the CTO say "we haven't thought of that."`,
    userPrompt: `Context (frozen):
- Customer: ${input.customerLegalName} (${input.customerDomain}) subjectType=${input.subjectType}
- Company profile: ${JSON.stringify(input.companyProfile, null, 2)}

CUSTOMER ASSESSMENT:
${assessmentSummary}

COMPETITIVE LANDSCAPE (strengths/weaknesses vs customer, market trends):
${competitionHighlights}

CUSTOMER MARKET ANALYSIS:
${input.customerMarketAnalysis.substring(0, 2000)}

IT STRATEGIES (approved):
${JSON.stringify(input.itStrategy.strategies, null, 2)}

SERVICE MATCHES:
${JSON.stringify(input.serviceMatching.matches, null, 2)}

Task — two-phase reasoning:

PHASE A — CAPABILITY BASELINE (produce capabilityBaseline field):
Given the customer's profile (${input.assessment.digitalMaturity.value} digital maturity, ~€${input.assessment.itSpendInMio.value}M IT spend, ${input.assessment.industries.value.join("/")} industry), assess what they almost certainly ALREADY have in production. Consider: their maturity level, their industry standard tooling, what competitors at this scale typically operate, and what the market analysis suggests about their current capabilities. Be specific — name the kinds of systems, platforms, and processes they likely run today.

PHASE B — GENERATE BEYOND THE BASELINE:
1. executiveBriefing — concise executive context
2. strategicHypotheses — hypotheses to validate during the meeting
3. questionsToAsk — smart questions, each tied to a strategy
4. strategicImpulses — non-salesy impulses, each with well-reasoned WHY/HOW/WHAT:
   - title: short name for the impulse
   - why: WHY this impulse matters NOW — ground it in the customer's specific situation, competitive pressure, or a gap visible in the competitive landscape above. Reference specific competitor data where relevant.
   - how: HOW to act on it — the practical approach, first steps, or mechanism. Be concrete enough that the customer can picture the path forward.
   - what: WHAT the expected outcome is — what changes for the customer if they pursue this, what they gain or avoid losing.
5. pocIdeas — generate 8-10 POC ideas (we will filter later). Each with:
   - title: short name for the POC
   - why: WHY this POC was suggested — what specific competitive gap or emerging opportunity triggered it? Reference the competitor comparison data.
   - how: HOW to make this POC awesome — the approach, key ingredients, what makes it compelling and low-risk yet impactful. Be specific enough that a team could start scoping.
   - successFactors: each factor has a metric AND a howToEnsure — don't just state the goal, explain the concrete mechanism or measurement approach that backs it.
   - bottomLine: WHO benefits (customers, partners, internal teams) and HOW if this POC succeeds and gets rolled out as a mature feature. Paint the end-state picture — what does the world look like when this is in production?

KEY RULES FOR IMPULSES AND POCS:
- Every impulse and POC must go BEYOND the capability baseline. Do not suggest what they likely already have.
- Prefer cross-domain POCs at the intersection of two strategy themes over single-theme ones.
- Reference specific competitive gaps: if a competitor leads in an area and the customer doesn't, that's a POC opportunity.
- No generic sales language. Every suggestion must be traceable to a specific finding from the competitive analysis or market data above.
- Do not introduce services not present in the service matching output.
- Prioritize the 3-5 most relevant strategies for the meeting.
- Every question must cite the related strategy id or name.
- POCs must be exploratory and low-risk.
- Impulses must feel like strategic advice from a domain expert, not a product pitch.
- For success factors: don't just say "reduce cost by 15%" — explain HOW that is measured and ensured (the backing mechanism, the data source, the validation approach).
- For bottom line: think through the value chain — if this POC becomes a mature product feature, who are the specific stakeholders that benefit and what changes in their day-to-day?

Output format:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- itStrategyId = "${input.itStrategy.id}"
- serviceMatchingId = "${input.serviceMatching.id}"`,
    outputSchema: salesMeetingPrepSchema,
    outputToolName: "save_sales_meeting_prep",
    outputToolDescription: "Save the structured sales meeting preparation",
    useWebSearch: false,
    maxTokens: 16000,
  });

  log(
    "phase-1",
    `Done: ${initial.strategicImpulses.length} impulses, ${initial.pocIdeas.length} POC candidates`,
  );

  // ── Phase 2: Score, validate novelty, and rank ──
  log("phase-2", "Scoring and ranking POC candidates...");

  const pocsForScoring = initial.pocIdeas
    .map(
      (p) =>
        `[POC] "${p.title}"
  WHY: ${p.why}
  HOW: ${p.how}
  BOTTOM LINE: ${p.bottomLine}
  SUCCESS FACTORS: ${p.successFactors.map((sf) => `${sf.metric} (backed by: ${sf.howToEnsure})`).join("; ")}`,
    )
    .join("\n\n");

  const impulsesForScoring = initial.strategicImpulses
    .map(
      (i) =>
        `[IMPULSE] "${i.title}": WHY=${i.why} | HOW=${i.how} | WHAT=${i.what}`,
    )
    .join("\n\n");

  const scoring = await callAgent({
    systemPrompt: `You are a senior technology executive at a large enterprise. You have seen every vendor pitch. You are allergic to generic suggestions.

Your job: evaluate and rank POC ideas and strategic impulses for a customer meeting.

For POCs, score on three dimensions:
1. NOVELTY — Is this genuinely beyond what they already have? (KEEP/SHARPEN/REPLACE)
2. BOTTOM-LINE STRENGTH (1-5) — How compelling is the "who benefits and how" when this becomes a mature feature? 5 = transformative value across multiple stakeholders (customers, partners, operations). 1 = narrow/incremental/obvious benefit.
3. SUCCESS FACTOR UNIQUENESS (1-5) — Are the success metrics differentiated and well-backed? 5 = specific metrics with concrete measurement mechanisms that show deep domain understanding. 1 = generic KPIs anyone could list without understanding the business.
4. COMPOSITE SCORE (1-10) — Overall quality combining all three dimensions. Use this for ranking.

Then select the TOP 3-5 POCs. Drop the weakest. A POC with a strong bottom line and unique success factors should rank higher even if slightly less novel than a POC with a weak bottom line.

For impulses, just assess novelty (KEEP/SHARPEN/REPLACE).

Be rigorous. A company with ${input.assessment.digitalMaturity.value} digital maturity and ~€${input.assessment.itSpendInMio.value}M IT spend in ${input.assessment.industries.value.join("/")} already has sophisticated capabilities.`,
    userPrompt: `CAPABILITY BASELINE (what they likely already have):
${initial.capabilityBaseline}

COMPETITIVE LANDSCAPE:
${competitionHighlights}

POC CANDIDATES TO SCORE AND RANK:
${pocsForScoring}

IMPULSES TO VALIDATE:
${impulsesForScoring}

Score each POC on all three dimensions. Then recommend the top 3-5 POCs by composite score. Drop the rest.
For impulses, provide novelty verdicts only.`,
    outputSchema: scoringResultSchema,
    outputToolName: "save_scoring",
    outputToolDescription: "Save POC scoring and ranking results",
    useWebSearch: false,
  });

  const keptPocTitles = new Set(scoring.recommendedPocTitles);
  const needsImprovementImpulses = scoring.impulseScores.filter(
    (s) => s.noveltyVerdict !== "KEEP",
  );
  const needsImprovementPocs = scoring.pocScores.filter(
    (s) => keptPocTitles.has(s.title) && s.noveltyVerdict !== "KEEP",
  );

  log(
    "phase-2",
    `Scored ${scoring.pocScores.length} POCs → selected top ${keptPocTitles.size}. ` +
      `Impulses: ${scoring.impulseScores.filter((s) => s.noveltyVerdict === "KEEP").length} KEEP, ${needsImprovementImpulses.length} need work`,
  );

  // Log POC rankings
  for (const poc of scoring.pocScores.sort(
    (a, b) => b.compositeScore - a.compositeScore,
  )) {
    const selected = keptPocTitles.has(poc.title) ? "✓" : "✗";
    log(
      "phase-2",
      `  ${selected} [${poc.compositeScore}/10] "${poc.title}" (BL:${poc.bottomLineStrength} SF:${poc.successFactorUniqueness} ${poc.noveltyVerdict})`,
    );
  }

  // Filter POCs to selected ones
  const selectedPocs = initial.pocIdeas.filter((p) =>
    keptPocTitles.has(p.title),
  );

  // ── Phase 3: Regenerate items that need improvement ──
  const totalNeedsWork =
    needsImprovementImpulses.length + needsImprovementPocs.length;

  if (totalNeedsWork === 0) {
    log("phase-3", "All selected items passed, no regeneration needed.");
    return { ...initial, pocIdeas: selectedPocs };
  }

  log(
    "phase-3",
    `Regenerating ${totalNeedsWork} items that need sharpening...`,
  );

  const failedImpulses = needsImprovementImpulses
    .map((v) => `"${v.title}" — ${v.noveltyVerdict}: ${v.noveltyReasoning}`)
    .join("\n");

  const failedPocs = needsImprovementPocs
    .map(
      (v) =>
        `"${v.title}" — ${v.noveltyVerdict}: ${v.noveltyReasoning} (BL:${v.bottomLineStrength}/5, SF:${v.successFactorUniqueness}/5)`,
    )
    .join("\n");

  const keptImpulseTitles = scoring.impulseScores
    .filter((v) => v.noveltyVerdict === "KEEP")
    .map((v) => v.title);

  const keptPocTitlesClean = scoring.pocScores
    .filter(
      (v) => keptPocTitles.has(v.title) && v.noveltyVerdict === "KEEP",
    )
    .map((v) => v.title);

  const regenerated = await callAgent<SalesMeetingPrep>({
    systemPrompt: `You are a senior sales engineer refining strategic impulses and POC ideas after scoring and novelty review. You must generate replacements that are genuinely novel for this specific customer.

Rules:
- Items marked SHARPEN: keep the core direction but add specific competitive context, tighter scope, or a concrete integration point. Strengthen the bottom line and success factor backing.
- Items marked REPLACE: generate a completely new suggestion using competitive gaps, cross-domain intersections, or emerging opportunities visible in the data.
- Items that passed (KEEP): return them unchanged.
- All suggestions must go beyond the capability baseline.
- Reference specific competitor data where possible.
- For POCs: ensure the bottom line paints a vivid end-state picture and success factors have concrete backing mechanisms.`,
    userPrompt: `CAPABILITY BASELINE:
${initial.capabilityBaseline}

CUSTOMER ASSESSMENT:
${assessmentSummary}

COMPETITIVE LANDSCAPE:
${competitionHighlights}

CUSTOMER MARKET ANALYSIS:
${input.customerMarketAnalysis.substring(0, 2000)}

IT STRATEGIES:
${JSON.stringify(input.itStrategy.strategies.map((s) => ({ name: s.name, intent: s.intent, competitiveRationale: s.competitiveRationale })), null, 2)}

SERVICE MATCHES:
${JSON.stringify(input.serviceMatching.matches.map((m) => ({ strategyName: m.strategyName, supportingServices: m.supportingServices })), null, 2)}

IMPULSES THAT PASSED (return these unchanged):
${keptImpulseTitles.map((t) => `- "${t}"`).join("\n") || "(none)"}

IMPULSES THAT NEED IMPROVEMENT:
${failedImpulses || "(none)"}

POCs THAT PASSED (return these unchanged — only these ${keptPocTitlesClean.length} POCs):
${keptPocTitlesClean.map((t) => `- "${t}"`).join("\n") || "(none)"}

POCs THAT NEED IMPROVEMENT (these were selected but need sharpening):
${failedPocs || "(none)"}

ORIGINAL FULL OUTPUT (preserve executiveBriefing, strategicHypotheses, questionsToAsk, capabilityBaseline unchanged — only improve the flagged impulses and POCs):
${JSON.stringify({ capabilityBaseline: initial.capabilityBaseline, executiveBriefing: initial.executiveBriefing, strategicHypotheses: initial.strategicHypotheses, questionsToAsk: initial.questionsToAsk }, null, 2)}

Return the complete sales meeting prep. Include ONLY the ${keptPocTitles.size} selected POCs (improved where flagged). Do NOT include dropped POCs.

Output format:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- itStrategyId = "${input.itStrategy.id}"
- serviceMatchingId = "${input.serviceMatching.id}"`,
    outputSchema: salesMeetingPrepSchema,
    outputToolName: "save_sales_meeting_prep_refined",
    outputToolDescription: "Save the refined sales meeting preparation",
    useWebSearch: false,
    maxTokens: 16000,
  });

  log(
    "phase-3",
    `Done: ${regenerated.strategicImpulses.length} impulses, ${regenerated.pocIdeas.length} POCs after refinement`,
  );

  return regenerated;
}
