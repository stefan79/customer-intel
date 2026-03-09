import { z } from "zod";

// ── Review Unit ──

export const reviewUnitSchema = z.object({
  unit_id: z.string().min(1).describe("Unique unit identifier, e.g. U-001"),
  unit_type: z
    .enum([
      "claim",
      "recommendation",
      "poc",
      "metric",
      "risk_control",
      "business_case",
      "question",
    ])
    .describe("Type of review unit"),
  section_ref: z
    .string()
    .min(1)
    .describe("Section heading or location reference"),
  text: z.string().min(1).describe("The verbatim text of the review unit"),
});

export const reviewUnitsSchema = z.object({
  units: z.array(reviewUnitSchema).min(1).describe("Segmented review units"),
});

// ── Issue Card ──

export const issueCardSchema = z.object({
  issue_id: z
    .string()
    .min(1)
    .describe("Unique issue identifier, e.g. I-001"),
  unit_id: z.string().min(1).describe("Reference to the review unit"),
  section_ref: z.string().min(1).describe("Section reference"),
  title: z.string().min(1).describe("One-line issue title"),
  raised_by: z
    .enum(["technical", "business"])
    .describe("Which challenger raised this"),
  issue_type: z
    .array(z.string().min(1))
    .describe(
      "Classification: technical_gap, data_dependency, integration_risk, regulation, security_privacy, safety_control, feasibility, metric_weakness, missing_owner, irrelevance, genericity, unclear_assumption, budget, owner, timing, incentive, adoption, governance, proof",
    ),
  regulatory_tags: z
    .array(z.string())
    .describe("Regulatory or compliance tags if applicable"),
  market_positioning: z
    .enum(["CUSTOMER_SPECIFIC", "VERTICAL_COMMON", "GENERIC_ISV", "OFF_STRATEGY"])
    .describe("How customer-specific is this content"),
  evidence_grade: z
    .enum(["A", "B", "C", "D"])
    .describe(
      "A=explicit in doc, B=strong inference, C=market heuristic, D=speculative",
    ),
  document_evidence: z
    .string()
    .describe("What the document explicitly states"),
  inference: z.string().describe("What can be reasonably inferred"),
  external_heuristic: z
    .string()
    .describe("Market or industry benchmark used"),
  unknowns: z
    .array(z.string())
    .describe("What is unknown or needs validation"),
  why_it_matters: z
    .string()
    .min(1)
    .describe("Why this would fail a customer review"),
  action: z
    .enum(["KEEP", "REWRITE", "REMOVE", "VALIDATE_FIRST"])
    .describe("Recommended action"),
  suggested_change: z
    .string()
    .min(1)
    .describe("Concrete rewrite, validation question, or removal rationale"),
  review_risk: z
    .number()
    .min(1)
    .max(5)
    .describe("Risk of this surviving customer review (1=low, 5=critical)"),
  priority: z
    .enum(["P0", "P1", "P2", "P3"])
    .describe("Priority: P0=stopper, P1=major, P2=strengthen, P3=polish"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Agent confidence in this assessment"),
});

export const issueCardsSchema = z.object({
  issues: z.array(issueCardSchema).describe("List of issue cards"),
});

// ── Agent Turn (conversation history) ──

export const agentTurnSchema = z.object({
  turn_id: z.string().min(1).describe("Unique turn identifier"),
  round: z.number().describe("Cross-exam round number"),
  issue_id: z.string().min(1).describe("Issue being discussed"),
  from_agent: z
    .enum(["technical", "business", "coordinator"])
    .describe("Who is speaking"),
  to_agent: z
    .enum(["technical", "business", "coordinator"])
    .describe("Who is addressed"),
  stance: z
    .enum(["raise", "challenge", "support", "refine", "resolve"])
    .describe("Agent stance on this turn"),
  message: z.string().min(1).describe("The agent's message"),
  confidence: z.number().min(0).max(1).describe("Confidence in this turn"),
});

// ── Final Issue ──

export const finalIssueSchema = z.object({
  issue_id: z.string().min(1),
  title: z.string().min(1),
  section_ref: z
    .string()
    .min(1)
    .describe(
      "Which section this issue targets: Strategic Hypotheses, Questions to Ask, Strategic Impulses, or POC Ideas",
    ),
  final_action: z.enum(["KEEP", "REWRITE", "REMOVE", "VALIDATE_FIRST"]),
  final_priority: z.enum(["P0", "P1", "P2", "P3"]),
  technical_reasoning: z
    .string()
    .min(1)
    .describe("Technical challenger's final reasoning"),
  business_reasoning: z
    .string()
    .min(1)
    .describe("Business challenger's final reasoning"),
  coordinator_reasoning: z
    .string()
    .min(1)
    .describe("Coordinator's final decision reasoning"),
  suggested_rewrite_or_validation: z
    .string()
    .min(1)
    .describe("The concrete improvement or validation step"),
  conversation_history: z
    .array(agentTurnSchema)
    .describe("Discussion turns for this issue"),
});

// ── Review Pack ──

export const reviewPackSchema = z.object({
  document_summary: z
    .string()
    .min(1)
    .describe("Concise summary of the document reviewed"),
  prioritized_issues: z
    .array(finalIssueSchema)
    .describe("Issues sorted by priority and risk"),
  open_questions: z
    .array(z.string().min(1))
    .describe("Questions that need customer validation"),
  low_priority_appendix: z
    .array(finalIssueSchema)
    .describe("P3 items for optional cleanup"),
});

// ── Merged Issues (coordinator merge step) ──

export const mergedIssuesSchema = z.object({
  merged_issues: z
    .array(
      z.object({
        issue_id: z.string().min(1),
        unit_id: z.string().min(1),
        section_ref: z.string().min(1),
        title: z.string().min(1),
        technical_view: z
          .string()
          .describe("Technical challenger perspective, empty if not raised"),
        business_view: z
          .string()
          .describe("Business challenger perspective, empty if not raised"),
        needs_crossexam: z
          .boolean()
          .describe("Whether this needs cross-examination"),
        crossexam_reason: z
          .string()
          .describe("Why cross-exam is needed"),
        preliminary_action: z.enum([
          "KEEP",
          "REWRITE",
          "REMOVE",
          "VALIDATE_FIRST",
        ]),
        preliminary_priority: z.enum(["P0", "P1", "P2", "P3"]),
      }),
    )
    .describe("Deduplicated and merged issues"),
});

// ── Cross-exam response ──

export const crossExamResponseSchema = z.object({
  responses: z
    .array(
      z.object({
        issue_id: z.string().min(1),
        stance: z.enum(["challenge", "support", "refine", "resolve"]),
        message: z
          .string()
          .min(1)
          .describe("Response to the cross-exam question"),
        revised_action: z
          .enum(["KEEP", "REWRITE", "REMOVE", "VALIDATE_FIRST"])
          .describe("Updated action recommendation after cross-exam"),
        revised_priority: z.enum(["P0", "P1", "P2", "P3"]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe("Responses to cross-examination"),
});

// Types
export type ReviewUnit = z.infer<typeof reviewUnitSchema>;
export type IssueCard = z.infer<typeof issueCardSchema>;
export type AgentTurn = z.infer<typeof agentTurnSchema>;
export type FinalIssue = z.infer<typeof finalIssueSchema>;
export type ReviewPack = z.infer<typeof reviewPackSchema>;
