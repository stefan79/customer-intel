import { z } from "zod";
import { callAgent } from "./client.js";
import {
  reviewUnitsSchema,
  issueCardsSchema,
  mergedIssuesSchema,
  crossExamResponseSchema,
  reviewPackSchema,
  type ReviewPack,
  type AgentTurn,
} from "./schemas-review.js";
import type { CompanyMasterData, CompanyAssessment } from "./schemas.js";

const regeneratedSectionsSchema = z.object({
  strategicHypotheses: z
    .string()
    .min(1)
    .describe(
      "The regenerated Strategic Hypotheses section in markdown. Each hypothesis is rewritten incorporating review feedback. After each changed item, include a change note.",
    ),
  questionsToAsk: z
    .string()
    .min(1)
    .describe(
      "The regenerated Questions to Ask section in markdown. Questions are improved based on review feedback. After each changed item, include a change note.",
    ),
  strategicImpulses: z
    .string()
    .min(1)
    .describe(
      "The regenerated Strategic Impulses section in markdown. Impulses are refined based on review feedback. After each changed item, include a change note.",
    ),
  pocIdeas: z
    .string()
    .min(1)
    .describe(
      "The regenerated POC Ideas section in markdown. POCs are improved based on review feedback. After each changed item, include a change note.",
    ),
});

// ── System Prompts ──

const TECH_SYSTEM = `You are TECH-CHALLENGER, a skeptical domain architect reviewing strategic recommendations in a customer-facing document.

Your job is to break weak technical reasoning before the customer's architects, operators, SMEs, security team, compliance team, or delivery leaders do.

You are reviewing ONLY these sections: Strategic Hypotheses, Questions to Ask, Strategic Impulses, and POC Ideas. The full report is provided as context so you understand the data behind the recommendations.

Review through these lenses:
- domain correctness and architecture completeness
- data flows, master data, integrations, and dependencies
- latency, scale, performance, and operational feasibility
- rollout realism, ownership, and change-management burden
- governance, auditability, privacy, safety, and regulated controls
- measurement design and success metrics
- vague claims, shallow statements, and vendor theater
- NOVELTY: whether a POC or impulse goes beyond what the customer likely already has (check the Assumed Capability Baseline section and competitive landscape in the annex)

For each issue:
1. cite the section and quote the triggering text
2. give the issue a one-line title
3. classify it
4. explain why it would fail a first customer review
5. separate: document evidence, inference, external heuristic, unknown
6. identify regulatory/control touchpoints if any
7. recommend one action: KEEP, REWRITE, REMOVE, VALIDATE_FIRST
8. propose a concrete improvement or validation question
9. assign priority (P0-P3), review_risk (1-5), confidence (0-1)

Rules:
- Do not invent customer facts.
- Do not give legal advice; flag compliance review instead.
- Prefer precise, causal criticism over general commentary.
- If it sounds like commodity ISV boilerplate, say so explicitly.
- If a PoC cannot be implemented or measured as written, explain why.
- Challenge any POC or impulse that sounds like a commodity capability for a company of this size, maturity, and industry. If the capability baseline suggests they already have it, flag as REMOVE or REWRITE.
- Cross-check POC novelty against the competitive landscape in the annex. A strong POC addresses a gap visible in the competitor comparison.
- Make every issue end in one of four verbs: specify, validate, narrow, or remove.`;

const BIZ_SYSTEM = `You are BUSINESS-CHALLENGER, a skeptical industry operator and commercial strategist reviewing strategic recommendations in a customer-facing document.

Your job is to break weak business reasoning before the customer's GM, BU leader, finance partner, operations sponsor, or transformation lead does.

You are reviewing ONLY these sections: Strategic Hypotheses, Questions to Ask, Strategic Impulses, and POC Ideas. The full report is provided as context so you understand the data behind the recommendations.

Review through these lenses:
- strategic relevance and timing
- customer specificity vs generic vendor pitch
- stakeholder map, budget owner, and political feasibility
- adoption friction and operating-model fit
- business value logic, value-proof path, and sequencing
- whether the PoC is small enough to buy and big enough to matter
- differentiation vs what every ISV could say
- whether it shows understanding of how the customer works today
- NOVELTY: whether a POC or impulse is genuinely beyond what this customer already does (check the Assumed Capability Baseline section and competitive landscape in the annex)

For each issue:
1. cite the section and quote the triggering text
2. give the issue a one-line title
3. explain why the point is weak commercially or politically
4. classify the blocker type
5. label market_positioning: CUSTOMER_SPECIFIC, VERTICAL_COMMON, GENERIC_ISV, or OFF_STRATEGY
6. separate: document evidence, inference, external heuristic, unknown
7. recommend one action: KEEP, REWRITE, REMOVE, VALIDATE_FIRST
8. propose a more concrete customer-ready version
9. assign priority (P0-P3), review_risk (1-5), confidence (0-1)

Rules:
- Do not invent customer facts.
- If big value numbers are used, challenge the basis, owner, and path to proof.
- Call out anything that sounds like a standard ISV pitch deck.
- Prefer concrete commercial rewrites over generic critique.
- Challenge any POC or impulse that a company with this digital maturity and IT spend would consider table-stakes. If the capability baseline says they likely already have it, mark as GENERIC_ISV and recommend REMOVE or REWRITE with a sharper competitive angle.
- Cross-check against competitor data in the annex: a truly differentiated POC addresses a visible competitive gap.
- Make every issue end in one of four verbs: specify, validate, narrow, or remove.`;

const COORDINATOR_SYSTEM = `You are REVIEW-COORDINATOR, the moderator and editor-in-chief of a three-agent document red-team.

Goal: Turn specialist feedback into an auditable, prioritized decision log, not a vague summary.

Responsibilities:
- Merge duplicate issues while keeping stable issue_ids
- Identify disagreements, low-evidence issues, and high-risk regulated points
- Preserve minority views if unresolved
- Every final issue must end with one action: KEEP, REWRITE, REMOVE, or VALIDATE_FIRST
- Always separate document evidence, inference, heuristic, and unknown
- Prefer fewer, sharper issues over long unprioritized output
- Sort by: priority, review_risk, confidence`;

// ── Orchestration ──

interface ReviewInput {
  reportText: string;
  customerName: string;
  customerDomain: string;
  masterData: CompanyMasterData;
  assessment: CompanyAssessment;
}

function log(step: string, message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [review] ${step}: ${message}`);
}

/**
 * Extract the strategic sections from the report for focused review.
 */
function extractStrategicSections(reportText: string): string {
  const sections = [
    "Strategic Hypotheses",
    "Questions to Ask",
    "Strategic Impulses",
    "POC Ideas",
  ];

  const extracted: string[] = [];
  for (const sectionName of sections) {
    const regex = new RegExp(
      `^## ${sectionName}\\n([\\s\\S]*?)(?=^## |^---\\n|^# Annex)`,
      "m",
    );
    const match = reportText.match(regex);
    if (match) {
      extracted.push(`## ${sectionName}\n${match[1].trim()}`);
    }
  }

  return extracted.join("\n\n");
}

export async function runReview(input: ReviewInput): Promise<ReviewPack> {
  const customerContext = `Customer: ${input.customerName} (${input.customerDomain})
Country: ${input.masterData.countryCode}
Industries: ${input.assessment.industries.value.join(", ")}
Markets: ${input.assessment.markets.value.join(", ")}
Revenue: ~${input.assessment.revenueInMio.value}M EUR
Employees: ~${input.assessment.numberOfEmployees.value}
Digital Maturity: ${input.assessment.digitalMaturity.value}`;

  const strategicSections = extractStrategicSections(input.reportText);

  // ── Step 1: Segment strategic sections into review units ──
  log("step-1", "Segmenting strategic sections into review units...");

  const segmented = await callAgent({
    systemPrompt: COORDINATOR_SYSTEM,
    userPrompt: `Segment the STRATEGIC SECTIONS below into atomic review units.

Customer context:
${customerContext}

SECTIONS TO REVIEW:
${strategicSections}

FULL REPORT (for context only - do NOT create review units for the annex sections):
${input.reportText}

For each unit, assign a type: claim, recommendation, poc, metric, risk_control, business_case, or question.
Extract the verbatim text and note the section reference (Strategic Hypotheses, Questions to Ask, Strategic Impulses, or POC Ideas).
Focus on substantive content that makes specific claims or recommendations.
Only segment content from the four strategic sections above, not from the annex.`,
    outputSchema: reviewUnitsSchema,
    outputToolName: "save_review_units",
    outputToolDescription: "Save the segmented review units",
  });

  log("step-1", `${segmented.units.length} review units identified`);

  const unitsContext = segmented.units
    .map((u) => `[${u.unit_id}] (${u.unit_type}) ${u.section_ref}\n${u.text}`)
    .join("\n\n");

  // ── Step 2: Run both challengers in parallel ──
  log("step-2", "Running technical and business challengers...");

  const challengerPrompt = (role: string) =>
    `Review these strategic recommendation units from a customer-facing document.

Customer context:
${customerContext}

UNITS TO REVIEW (from Strategic Hypotheses, Questions to Ask, Strategic Impulses, POC Ideas):
${unitsContext}

FULL REPORT (for context - use this to understand the data behind the recommendations):
${input.reportText}

Raise the highest-risk ${role} issues. Return up to 12 IssueCards.
For raised_by, always set "${role === "technical/domain" ? "technical" : "business"}".
Focus on what would make these strategic sections non-defensible in front of a ${role} specialist.
Only raise issues about the strategic sections (hypotheses, questions, impulses, POC ideas), not the annex data.`;

  const [techIssues, bizIssues] = await Promise.all([
    callAgent({
      systemPrompt: TECH_SYSTEM,
      userPrompt: challengerPrompt("technical/domain"),
      outputSchema: issueCardsSchema,
      outputToolName: "save_tech_issues",
      outputToolDescription: "Save technical challenger issues",
    }),
    callAgent({
      systemPrompt: BIZ_SYSTEM,
      userPrompt: challengerPrompt("business/commercial"),
      outputSchema: issueCardsSchema,
      outputToolName: "save_biz_issues",
      outputToolDescription: "Save business challenger issues",
    }),
  ]);

  log(
    "step-2",
    `Technical: ${techIssues.issues.length} issues, Business: ${bizIssues.issues.length} issues`,
  );

  // ── Step 3: Coordinator merges issues ──
  log("step-3", "Merging and deduplicating issues...");

  const allIssuesJson = JSON.stringify(
    [...techIssues.issues, ...bizIssues.issues],
    null,
    2,
  );

  const merged = await callAgent({
    systemPrompt: COORDINATOR_SYSTEM,
    userPrompt: `Merge and deduplicate these issues from both challengers.

Customer context:
${customerContext}

All Issues:
${allIssuesJson}

Cluster duplicates by: same section_ref, same core complaint, same action type.
If both specialists raise the same issue, keep one issue_id and preserve both views.
Mark issues for cross-exam when: specialists disagree, evidence grade is C/D, issue is regulated/high-risk, or recommendation changes priority.`,
    outputSchema: mergedIssuesSchema,
    outputToolName: "save_merged_issues",
    outputToolDescription: "Save merged issue register",
  });

  log(
    "step-3",
    `${merged.merged_issues.length} merged issues, ${merged.merged_issues.filter((i) => i.needs_crossexam).length} need cross-exam`,
  );

  // ── Step 4: Cross-exam for disputed/high-risk issues ──
  const crossExamIssues = merged.merged_issues.filter(
    (i) => i.needs_crossexam,
  );
  const conversationHistory: AgentTurn[] = [];

  if (crossExamIssues.length > 0) {
    log(
      "step-4",
      `Cross-examining ${crossExamIssues.length} issues...`,
    );

    const crossExamContext = crossExamIssues
      .map(
        (i) =>
          `[${i.issue_id}] ${i.title}
Section: ${i.section_ref}
Reason for cross-exam: ${i.crossexam_reason}
Technical view: ${i.technical_view || "not raised"}
Business view: ${i.business_view || "not raised"}
Preliminary action: ${i.preliminary_action}`,
      )
      .join("\n\n");

    const [techCrossExam, bizCrossExam] = await Promise.all([
      callAgent({
        systemPrompt: TECH_SYSTEM,
        userPrompt: `Cross-examination round. For each issue below, the business challenger has a different view. Respond with your refined stance.

Customer context:
${customerContext}

Issues for cross-exam:
${crossExamContext}

For each issue, state whether you challenge, support, or refine the business view. Provide your revised action and priority.`,
        outputSchema: crossExamResponseSchema,
        outputToolName: "save_tech_crossexam",
        outputToolDescription: "Save technical cross-exam responses",
      }),
      callAgent({
        systemPrompt: BIZ_SYSTEM,
        userPrompt: `Cross-examination round. For each issue below, the technical challenger has a different view. Respond with your refined stance.

Customer context:
${customerContext}

Issues for cross-exam:
${crossExamContext}

For each issue, state whether you challenge, support, or refine the technical view. Provide your revised action and priority.`,
        outputSchema: crossExamResponseSchema,
        outputToolName: "save_biz_crossexam",
        outputToolDescription: "Save business cross-exam responses",
      }),
    ]);

    for (const resp of techCrossExam.responses) {
      conversationHistory.push({
        turn_id: `T-tech-${resp.issue_id}`,
        round: 1,
        issue_id: resp.issue_id,
        from_agent: "technical",
        to_agent: "business",
        stance: resp.stance,
        message: resp.message,
        confidence: resp.confidence,
      });
    }
    for (const resp of bizCrossExam.responses) {
      conversationHistory.push({
        turn_id: `T-biz-${resp.issue_id}`,
        round: 1,
        issue_id: resp.issue_id,
        from_agent: "business",
        to_agent: "technical",
        stance: resp.stance,
        message: resp.message,
        confidence: resp.confidence,
      });
    }

    log("step-4", "Cross-exam complete");
  } else {
    log("step-4", "No issues need cross-exam, skipping");
  }

  // ── Step 5: Coordinator finalizes ──
  log("step-5", "Finalizing review pack...");

  const reviewPack = await callAgent({
    systemPrompt: COORDINATOR_SYSTEM,
    userPrompt: `Finalize the review pack. Produce the final prioritized assessment.

Customer context:
${customerContext}

Sections under review: Strategic Hypotheses, Questions to Ask, Strategic Impulses, POC Ideas

Merged Issues:
${JSON.stringify(merged.merged_issues, null, 2)}

Cross-exam History:
${JSON.stringify(conversationHistory, null, 2)}

Original Technical Issues:
${JSON.stringify(techIssues.issues.map((i) => ({ issue_id: i.issue_id, title: i.title, section_ref: i.section_ref, why_it_matters: i.why_it_matters, action: i.action, suggested_change: i.suggested_change, priority: i.priority })), null, 2)}

Original Business Issues:
${JSON.stringify(bizIssues.issues.map((i) => ({ issue_id: i.issue_id, title: i.title, section_ref: i.section_ref, why_it_matters: i.why_it_matters, action: i.action, suggested_change: i.suggested_change, priority: i.priority })), null, 2)}

For each final issue:
- Include technical_reasoning, business_reasoning, and your coordinator_reasoning
- Set the final_action and final_priority
- Include the suggested_rewrite_or_validation
- Include conversation_history turns from the cross-exam (if any)
- Sort prioritized_issues by priority then review_risk
- Put P3 items in low_priority_appendix
- List open_questions that need customer validation`,
    outputSchema: reviewPackSchema,
    outputToolName: "save_review_pack",
    outputToolDescription: "Save the final review pack",
    maxTokens: 16000,
  });

  log(
    "step-5",
    `Done: ${reviewPack.prioritized_issues.length} prioritized issues, ${reviewPack.open_questions.length} open questions`,
  );

  return reviewPack;
}

// ── Regenerate strategic sections based on review findings ──

export async function applyReview(
  originalReport: string,
  reviewPack: ReviewPack,
  customerContext: string,
): Promise<string> {
  log("rewrite", "Regenerating strategic sections based on review findings...");

  const strategicSections = extractStrategicSections(originalReport);

  const allIssues = [
    ...reviewPack.prioritized_issues,
    ...reviewPack.low_priority_appendix,
  ];

  const issuesForPrompt = allIssues
    .map(
      (i) =>
        `[${i.issue_id}] [${i.final_priority}] "${i.title}"
Section: ${i.section_ref || "unspecified"}
Action: ${i.final_action}
Technical reasoning: ${i.technical_reasoning}
Business reasoning: ${i.business_reasoning}
Coordinator decision: ${i.coordinator_reasoning}
Suggested rewrite/validation: ${i.suggested_rewrite_or_validation}`,
    )
    .join("\n\n");

  const result = await callAgent({
    systemPrompt: `You are a senior strategy editor. Your job is to regenerate the strategic sections of a customer-facing intelligence report by incorporating red-team review findings.

You receive:
1. The ORIGINAL strategic sections (baseline)
2. The REVIEW FINDINGS from technical and business challengers
3. The FULL REPORT as context

Your output: Four regenerated sections where the review findings are APPLIED — not appended as comments but actually incorporated into improved content.

Rules:
- For REWRITE findings: rewrite the affected item to address the weakness. Make it stronger, more specific, more defensible.
- For REMOVE findings: drop the item entirely.
- For VALIDATE_FIRST findings: keep the item but add a qualification or caveat that flags what needs validation.
- For KEEP findings: leave the item unchanged.
- Items that have NO review findings: keep them exactly as-is.

CHANGE NOTES — this is critical:
- After each item that was changed (rewritten, removed, or qualified), add a change note as an italic line.
- Format: _Updated ([issue-id]): One sentence explaining what changed and why, referencing the technical or business rationale._
- For removed items, add: _Removed ([issue-id]): One sentence explaining why this was dropped._
- Items that were not changed get NO change note.

Quality rules:
- Do not invent customer facts. Only use information from the report and review findings.
- The regenerated content should read as a polished, customer-ready document — not a draft with tracked changes.
- Maintain the original markdown structure (numbered lists for hypotheses, bullet lists for questions/impulses, ### subsections for POC ideas).
- Keep the same level of detail or better. Do not truncate content.
- Open questions from the review should be woven into VALIDATE_FIRST items as "needs validation" notes, not listed separately.`,
    userPrompt: `Regenerate the four strategic sections incorporating the review findings.

Customer context:
${customerContext}

REVIEW FINDINGS TO APPLY:
${issuesForPrompt || "(no actionable issues — return original sections unchanged)"}

OPEN QUESTIONS (weave into relevant items as validation notes):
${reviewPack.open_questions.map((q) => `- ${q}`).join("\n") || "(none)"}

ORIGINAL STRATEGIC SECTIONS (baseline):
${strategicSections}

FULL REPORT (for context only):
${originalReport}

Return each section fully regenerated with review findings applied and change notes after modified items.`,
    outputSchema: regeneratedSectionsSchema,
    outputToolName: "save_regenerated_sections",
    outputToolDescription: "Save regenerated strategic sections with applied review findings",
    maxTokens: 16000,
  });

  // Rebuild the report: replace strategic sections with regenerated versions
  let finalReport = originalReport;

  const replacements: [string, string][] = [
    ["Strategic Hypotheses", result.strategicHypotheses],
    ["Questions to Ask", result.questionsToAsk],
    ["Strategic Impulses", result.strategicImpulses],
    ["POC Ideas", result.pocIdeas],
  ];

  for (const [sectionName, newContent] of replacements) {
    const regex = new RegExp(
      `(## ${sectionName}\\n)[\\s\\S]*?(?=## |---\\n|# Annex)`,
      "m",
    );
    finalReport = finalReport.replace(regex, `## ${sectionName}\n\n${newContent}\n\n`);
  }

  log("rewrite", "Done — strategic sections regenerated with review findings applied");
  return finalReport;
}
