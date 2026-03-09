import { z } from "zod";
import { callAgent } from "../client.js";
import {
  domain,
  subjectType,
  legalName,
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

// ── Draft schemas (Phase 1 — no research fields, no POCs) ──

const draftImpulseSchema = z.object({
  title: z.string().min(1).describe("Short title for the impulse"),
  why: z
    .string()
    .min(1)
    .describe(
      "WHY this impulse matters now — the reasoning behind the suggestion, grounded in the customer's situation, market dynamics, or competitive pressure",
    ),
  how: z
    .string()
    .min(1)
    .describe(
      "HOW to act on it — the practical approach, first steps, or mechanism to explore this impulse with the customer",
    ),
  what: z
    .string()
    .min(1)
    .describe(
      "WHAT the expected outcome or impact is — what changes if the customer pursues this, what they gain",
    ),
});

const draftPrepSchema = z
  .object({
    id: z.string().min(1),
    customerDomain: domain,
    subjectType,
    customerLegalName: legalName,
    itStrategyId: z.string().min(1),
    serviceMatchingId: z.string().min(1),
    capabilityBaseline: z
      .string()
      .min(1)
      .describe(
        "Assessment of what the customer likely already has in production given their size, digital maturity, industry, and competitive position",
      ),
    executiveBriefing: z
      .string()
      .min(1)
      .describe("Executive-ready briefing summary"),
    strategicHypotheses: z
      .array(z.string().min(1))
      .describe("Hypotheses to validate during the meeting"),
    questionsToAsk: z
      .array(z.string().min(1))
      .describe("Questions tied to strategies"),
    strategicImpulses: z
      .array(draftImpulseSchema)
      .describe("Draft strategic impulses (research fields added later)"),
  })
  .describe("Draft sales meeting prep — impulses without research, no POCs");

type DraftPrep = z.infer<typeof draftPrepSchema>;

// ── Impulse research schema (Phase 2) ──

const impulseResearchResultSchema = z.object({
  impulseTitle: z
    .string()
    .min(1)
    .describe("Title of the impulse being researched"),
  industryStandard: z
    .string()
    .min(1)
    .describe(
      "IS state — current industry standard practice. What most companies in this segment at this scale do today in this area.",
    ),
  leaderPractices: z
    .string()
    .min(1)
    .describe(
      "TO BE state — what leaders and innovators in this segment are doing. The frontier. Name specific companies and initiatives where possible.",
    ),
  caveats: z
    .string()
    .min(1)
    .describe(
      "Regulatory, compliance, data privacy, or operational constraints to consider when pursuing this impulse.",
    ),
  analystView: z
    .string()
    .min(1)
    .describe(
      "What industry analysts (Gartner, Forrester, McKinsey, IDC, etc.) and advisors recommend in this area. Reference specific reports or frameworks where possible.",
    ),
  sources: z
    .array(z.string().min(1))
    .describe("URLs of sources found during research"),
});

type ImpulseResearchResult = z.infer<typeof impulseResearchResultSchema>;

// ── Scoring schemas (Phase 4) ──

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
    .describe(
      "Why this novelty verdict — reference baseline and competitive context",
    ),
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

// ── Helper functions ──

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

// ── Main function ──

export async function generateSalesMeetingPrep(
  input: SalesMeetingPrepInput,
): Promise<SalesMeetingPrep> {
  const assessmentSummary = buildAssessmentSummary(input.assessment);
  const competitionHighlights = buildCompetitionHighlights(
    input.competitionAnalyses,
  );

  // ════════════════════════════════════════════════════════
  // Phase 1: Generate draft (briefing, hypotheses, questions, impulses — NO POCs, NO research)
  // ════════════════════════════════════════════════════════
  log("phase-1", "Generating draft: briefing, hypotheses, questions, impulses (no POCs yet)...");

  const draft = await callAgent<DraftPrep>({
    systemPrompt: `You are a senior sales engineer preparing an executive meeting. You seek insight and trust, not closing.

CRITICAL RULE: You must think like a domain expert who has done their homework, not a consultant recycling boilerplate.

Before generating ANY impulses, you MUST first produce a capabilityBaseline: an honest assessment of what the customer LIKELY ALREADY HAS in production given their size, digital maturity, industry, and competitive position. This is the floor. Everything you suggest must go ABOVE this floor.

The golden test for every impulse: "Would a senior technology leader at this company say 'we already do that'?" If yes, it is worthless — go deeper, go cross-domain, go to the intersection of two strategy themes, or find a specific competitive gap they haven't closed.

IMPORTANT: Do NOT generate POC ideas in this step. POCs will be generated later after the impulses have been enriched with web research. Focus on generating high-quality strategic impulses with clear WHY/HOW/WHAT reasoning.`,
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
4. strategicImpulses — 4-6 non-salesy impulses, each with well-reasoned WHY/HOW/WHAT:
   - title: short name for the impulse
   - why: WHY this impulse matters NOW — ground it in the customer's specific situation, competitive pressure, or a gap visible in the competitive landscape above. Reference specific competitor data where relevant.
   - how: HOW to act on it — the practical approach, first steps, or mechanism. Be concrete enough that the customer can picture the path forward.
   - what: WHAT the expected outcome is — what changes for the customer if they pursue this, what they gain or avoid losing.

KEY RULES:
- Every impulse must go BEYOND the capability baseline.
- Prefer cross-domain impulses at the intersection of two strategy themes.
- Reference specific competitive gaps.
- No generic sales language. Every suggestion must be traceable to specific findings.
- Impulses must feel like strategic advice from a domain expert, not a product pitch.
- Prioritize the 3-5 most relevant strategies for the meeting.
- Every question must cite the related strategy id or name.

Output format:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- itStrategyId = "${input.itStrategy.id}"
- serviceMatchingId = "${input.serviceMatching.id}"`,
    outputSchema: draftPrepSchema,
    outputToolName: "save_draft_prep",
    outputToolDescription: "Save the draft sales meeting preparation (without POCs or research)",
    useWebSearch: false,
    maxTokens: 8000,
  });

  log(
    "phase-1",
    `Done: ${draft.strategicImpulses.length} draft impulses generated`,
  );

  // ════════════════════════════════════════════════════════
  // Phase 2: Research each impulse with web search (sequential)
  // ════════════════════════════════════════════════════════
  log("phase-2", `Researching ${draft.strategicImpulses.length} impulses with web search...`);

  const researchResults: ImpulseResearchResult[] = [];

  for (let idx = 0; idx < draft.strategicImpulses.length; idx++) {
    const impulse = draft.strategicImpulses[idx];
    log("phase-2", `  [${idx + 1}/${draft.strategicImpulses.length}] Researching: "${impulse.title}"...`);

    const research = await callAgent<ImpulseResearchResult>({
      systemPrompt: `You are an industry research analyst specializing in ${input.assessment.industries.value.join(", ")}. Your job is to investigate a strategic impulse for a specific customer and provide grounded, data-backed research findings.

You MUST use web search to find current, real data. Do not make up or hallucinate sources. Every claim should be backed by a real URL.

Research these four dimensions:

1. INDUSTRY STANDARD (IS state): What is standard practice TODAY for companies in ${input.assessment.industries.value.join("/")} at the ~€${input.assessment.revenueInMio.value}M revenue scale? What do most companies already do in this area? Be specific — name technologies, platforms, approaches that are table stakes.

2. LEADER PRACTICES (TO BE state): What are the leaders and innovators doing? Name SPECIFIC companies and their SPECIFIC initiatives where possible. What does the frontier look like? What separates leaders from the pack?

3. CAVEATS: What regulatory, compliance, data privacy, or operational constraints apply? Consider region-specific regulation (EU AI Act, GDPR, sector-specific rules), technical debt concerns, organizational readiness barriers, and vendor lock-in risks.

4. ANALYST VIEW: What do industry analysts (Gartner, Forrester, McKinsey, IDC, BCG, Deloitte, etc.) recommend in this area? Reference specific reports, Magic Quadrants, Hype Cycles, or framework recommendations where possible. Include recent (2024-2025) findings.

Be thorough but concise. Each dimension should be a substantive paragraph, not a one-liner.`,
      userPrompt: `CUSTOMER CONTEXT:
- Company: ${input.customerLegalName} (${input.customerDomain})
- Industries: ${input.assessment.industries.value.join(", ")}
- Revenue: ~€${input.assessment.revenueInMio.value}M | Digital Maturity: ${input.assessment.digitalMaturity.value}
- Markets: ${input.assessment.markets.value.join(", ")}
- Constraints: ${input.assessment.industrySpecificConstraints.value.join(", ") || "none identified"}

STRATEGIC IMPULSE TO RESEARCH:
Title: ${impulse.title}
WHY: ${impulse.why}
HOW: ${impulse.how}
WHAT: ${impulse.what}

Search the web for current information on this topic in the context of the ${input.assessment.industries.value.join("/")} industry. Look for:
- What companies at this scale typically have in place today (IS state)
- What innovative leaders are doing (TO BE state)
- Relevant regulations and constraints
- Recent analyst reports and recommendations

Return your findings structured into the four dimensions. Include all source URLs.`,
      outputSchema: impulseResearchResultSchema,
      outputToolName: "save_impulse_research",
      outputToolDescription: "Save the web-research findings for this strategic impulse",
      useWebSearch: true,
      maxSearches: 5,
      maxTokens: 4000,
    });

    researchResults.push(research);
    log("phase-2", `  [${idx + 1}/${draft.strategicImpulses.length}] Done: ${research.sources.length} sources found`);
  }

  log("phase-2", `All ${researchResults.length} impulses researched`);

  // Merge research into impulses to produce full strategicImpulse objects
  const researchedImpulses = draft.strategicImpulses.map((impulse, idx) => {
    const research = researchResults[idx];
    return {
      title: impulse.title,
      why: impulse.why,
      how: impulse.how,
      what: impulse.what,
      industryStandard: research.industryStandard,
      leaderPractices: research.leaderPractices,
      caveats: research.caveats,
      analystView: research.analystView,
      sources: research.sources,
    };
  });

  // ════════════════════════════════════════════════════════
  // Phase 3: Generate POCs using researched impulses as grounding
  // ════════════════════════════════════════════════════════
  log("phase-3", "Generating 8-10 POC candidates using researched impulses as context...");

  // Build impulse research summary for POC generation context
  const impulseResearchContext = researchedImpulses
    .map(
      (imp) =>
        `### ${imp.title}
**WHY:** ${imp.why}
**HOW:** ${imp.how}
**WHAT:** ${imp.what}
**Industry Standard (IS):** ${imp.industryStandard}
**Leader Practices (TO BE):** ${imp.leaderPractices}
**Caveats:** ${imp.caveats}
**Analyst View:** ${imp.analystView}
**Sources:** ${imp.sources.join(", ")}`,
    )
    .join("\n\n");

  const withPocs = await callAgent<SalesMeetingPrep>({
    systemPrompt: `You are a senior sales engineer generating POC ideas for a customer meeting. You have access to thoroughly researched strategic impulses — each with industry standard (IS), leader practices (TO BE), caveats, and analyst recommendations backed by web sources.

Your job: generate 8-10 POC ideas that are grounded in the research findings. Each POC should:
1. Reference the IS→TO BE gap from a specific impulse's research — what does the customer currently do (IS) vs what leaders do (TO BE)? The POC should bridge this gap.
2. Account for caveats identified in the research — regulatory constraints, compliance requirements, operational barriers.
3. Align success factors with what analysts recommend — if Gartner says "measure X", the POC should measure X.
4. Paint a bottom line that reflects what leaders achieve — use the leader practices as evidence for what's possible.

CRITICAL: The impulses and their research fields are ALREADY FINAL. Return them EXACTLY as provided — do not modify any impulse field. Your only job is to add the pocIdeas array.

IMPORTANT: Generate 8-10 POC ideas. Cast a wide net — include cross-domain intersections, competitive gap exploits, and ideas that would make the CTO say "we haven't thought of that." We will score and filter them later.`,
    userPrompt: `Context (frozen):
- Customer: ${input.customerLegalName} (${input.customerDomain}) subjectType=${input.subjectType}

CUSTOMER ASSESSMENT:
${assessmentSummary}

CAPABILITY BASELINE (what they likely already have — all POCs must go BEYOND this):
${draft.capabilityBaseline}

COMPETITIVE LANDSCAPE:
${competitionHighlights}

RESEARCHED STRATEGIC IMPULSES (with industry research findings):
${impulseResearchContext}

IT STRATEGIES (approved):
${JSON.stringify(input.itStrategy.strategies.map((s) => ({ name: s.name, intent: s.intent, competitiveRationale: s.competitiveRationale })), null, 2)}

SERVICE MATCHES:
${JSON.stringify(input.serviceMatching.matches.map((m) => ({ strategyName: m.strategyName, supportingServices: m.supportingServices })), null, 2)}

Generate 8-10 POC ideas grounded in the researched impulses above. For each POC:
- title: short name
- why: WHY this POC — reference the specific IS→TO BE gap from the impulse research. What competitive gap or emerging opportunity triggered it?
- how: HOW to make it awesome — the approach, key ingredients. Account for caveats (regulatory, compliance, operational constraints) identified in the research.
- successFactors: each has a metric AND howToEnsure. Align with analyst recommendations where possible.
- bottomLine: WHO benefits and HOW when this becomes a mature feature. Reference leader practices as evidence for what's achievable.

RULES:
- Every POC must go BEYOND the capability baseline.
- Prefer cross-domain POCs at the intersection of two strategy themes.
- Reference specific competitive gaps and research findings.
- No generic sales language.
- Do not introduce services not in the service matching output.
- POCs must be exploratory and low-risk.
- For success factors: don't just say "reduce cost by 15%" — explain HOW that is measured and ensured.
- For bottom line: think through the value chain. Paint the end-state picture.

IMPORTANT: Return the COMPLETE sales meeting prep output. Carry forward ALL fields from the draft exactly as-is:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- itStrategyId = "${input.itStrategy.id}"
- serviceMatchingId = "${input.serviceMatching.id}"
- capabilityBaseline = (exactly as provided above)
- executiveBriefing = "${draft.executiveBriefing.substring(0, 100)}..."
- strategicHypotheses = (exactly as provided)
- questionsToAsk = (exactly as provided)
- strategicImpulses = (exactly as provided — with ALL research fields)
- pocIdeas = (NEW — your 8-10 POC ideas)

PRESERVED FIELDS (copy these verbatim):
${JSON.stringify({
  capabilityBaseline: draft.capabilityBaseline,
  executiveBriefing: draft.executiveBriefing,
  strategicHypotheses: draft.strategicHypotheses,
  questionsToAsk: draft.questionsToAsk,
  strategicImpulses: researchedImpulses,
}, null, 2)}`,
    outputSchema: salesMeetingPrepSchema,
    outputToolName: "save_sales_meeting_prep",
    outputToolDescription: "Save the structured sales meeting preparation with research-backed impulses and POC ideas",
    useWebSearch: false,
    maxTokens: 16000,
  });

  log(
    "phase-3",
    `Done: ${withPocs.pocIdeas.length} POC candidates generated using researched impulses`,
  );

  // Ensure the researched impulses are preserved exactly (agent may have modified them)
  const result: SalesMeetingPrep = {
    ...withPocs,
    strategicImpulses: researchedImpulses,
  };

  // ════════════════════════════════════════════════════════
  // Phase 4: Score, validate novelty, and rank
  // ════════════════════════════════════════════════════════
  log("phase-4", "Scoring and ranking POC candidates...");

  const pocsForScoring = result.pocIdeas
    .map(
      (p) =>
        `[POC] "${p.title}"
  WHY: ${p.why}
  HOW: ${p.how}
  BOTTOM LINE: ${p.bottomLine}
  SUCCESS FACTORS: ${p.successFactors.map((sf) => `${sf.metric} (backed by: ${sf.howToEnsure})`).join("; ")}`,
    )
    .join("\n\n");

  const impulsesForScoring = result.strategicImpulses
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
${result.capabilityBaseline}

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
    "phase-4",
    `Scored ${scoring.pocScores.length} POCs → selected top ${keptPocTitles.size}. ` +
      `Impulses: ${scoring.impulseScores.filter((s) => s.noveltyVerdict === "KEEP").length} KEEP, ${needsImprovementImpulses.length} need work`,
  );

  // Log POC rankings
  for (const poc of scoring.pocScores.sort(
    (a, b) => b.compositeScore - a.compositeScore,
  )) {
    const selected = keptPocTitles.has(poc.title) ? "✓" : "✗";
    log(
      "phase-4",
      `  ${selected} [${poc.compositeScore}/10] "${poc.title}" (BL:${poc.bottomLineStrength} SF:${poc.successFactorUniqueness} ${poc.noveltyVerdict})`,
    );
  }

  // Filter POCs to selected ones
  const selectedPocs = result.pocIdeas.filter((p) =>
    keptPocTitles.has(p.title),
  );

  // ════════════════════════════════════════════════════════
  // Phase 5: Regenerate items that need improvement
  // ════════════════════════════════════════════════════════
  const totalNeedsWork =
    needsImprovementImpulses.length + needsImprovementPocs.length;

  if (totalNeedsWork === 0) {
    log("phase-5", "All selected items passed, no regeneration needed.");
    return { ...result, pocIdeas: selectedPocs };
  }

  log(
    "phase-5",
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
- Items that passed (KEEP): return them unchanged — preserve ALL fields exactly, including research fields (industryStandard, leaderPractices, caveats, analystView, sources) on impulses.
- All suggestions must go beyond the capability baseline.
- Reference specific competitor data where possible.
- For POCs: ensure the bottom line paints a vivid end-state picture and success factors have concrete backing mechanisms.
- For impulses that need improvement: you MUST populate the research fields (industryStandard, leaderPractices, caveats, analystView, sources) based on your knowledge. Be specific and substantive.`,
    userPrompt: `CAPABILITY BASELINE:
${result.capabilityBaseline}

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

IMPULSES THAT PASSED (return these EXACTLY as-is, including ALL research fields):
${keptImpulseTitles.map((t) => `- "${t}"`).join("\n") || "(none)"}

IMPULSES THAT NEED IMPROVEMENT:
${failedImpulses || "(none)"}

POCs THAT PASSED (return these unchanged — only these ${keptPocTitlesClean.length} POCs):
${keptPocTitlesClean.map((t) => `- "${t}"`).join("\n") || "(none)"}

POCs THAT NEED IMPROVEMENT (these were selected but need sharpening):
${failedPocs || "(none)"}

ORIGINAL FULL OUTPUT (preserve executiveBriefing, strategicHypotheses, questionsToAsk, capabilityBaseline unchanged — only improve the flagged impulses and POCs):
${JSON.stringify({
  capabilityBaseline: result.capabilityBaseline,
  executiveBriefing: result.executiveBriefing,
  strategicHypotheses: result.strategicHypotheses,
  questionsToAsk: result.questionsToAsk,
  strategicImpulses: researchedImpulses,
}, null, 2)}

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

  // Preserve the web-researched impulses for items that were KEEP
  const finalImpulses = regenerated.strategicImpulses.map((imp) => {
    const keptOriginal = researchedImpulses.find(
      (orig) => orig.title === imp.title && keptImpulseTitles.includes(orig.title),
    );
    return keptOriginal ?? imp;
  });

  log(
    "phase-5",
    `Done: ${finalImpulses.length} impulses, ${regenerated.pocIdeas.length} POCs after refinement`,
  );

  return { ...regenerated, strategicImpulses: finalImpulses };
}
