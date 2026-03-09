import { z } from "zod";

// Base field definitions
export const legalName = z
  .string()
  .min(1)
  .max(255)
  .describe("The complete legal name of the company");
export const domain = z
  .string()
  .min(1)
  .max(255)
  .describe(
    "The main domain of the company homepage in the format of name.tld",
  );
export const subjectType = z
  .enum(["customer", "competitor"])
  .describe("Whether the subject is the original customer or a competitor");
export const markets = z
  .array(
    z
      .string()
      .min(2)
      .max(2)
      .describe(
        "ISO 3166-1 alpha-2 country code, or global in case of a global acting entity",
      ),
  )
  .describe("Primary markets generating >= 80% of revenue");
export const industries = z
  .array(z.string().min(1).max(255).describe("Industry name"))
  .describe(
    "Verticals, Business Models, Value Chains the company is active in",
  );
export const revenueInMio = z
  .number()
  .describe("Annual Revenue in Million Euros");

function createEstimate<T extends z.ZodTypeAny>(field: T) {
  return z.object({
    value: field,
    source: z
      .string()
      .min(1)
      .describe("How the estimate / data entry was determined."),
    citation: z.string().min(1).describe("URL of the source"),
    date: z
      .string()
      .min(1)
      .describe("Date on which the estimate / data entry was determined on"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "1 if the specific value was found, otherwise the confidence of your estimate.",
      ),
  });
}

// Schemas
export const companyMasterDataSchema = z
  .object({
    domain,
    legalName,
    countryCode: z
      .string()
      .min(1)
      .max(255)
      .describe("The ISO country code of the company residence"),
    address: z
      .object({
        street: z.string().min(1).max(255),
        city: z.string().min(1).max(255),
        region: z.string().min(1).max(255),
        postalCode: z.string().min(1).max(255),
        country: z.string().min(1).max(255),
      })
      .describe("The Headquarters of the Company"),
  })
  .describe("Master Data for a company");

export const competingCompaniesSchema = z
  .object({
    customerLegalName: legalName,
    customerDomain: domain,
    competition: z
      .array(
        z
          .object({
            competitionLegalName: legalName,
            competitionDomain: domain,
          })
          .describe("An individual reference to a company"),
      )
      .describe("References to competing companies"),
  })
  .describe("A collection of competing companies for a specific customer");

export const companyAssessmentSchema = z.object({
  domain,
  customerDomain: domain.describe(
    "The originating customer domain for this assessment",
  ),
  subjectType,
  revenueInMio: createEstimate(revenueInMio).describe("Annual Revenue"),
  revenueGrowth: createEstimate(
    z.number().describe("Annual Growth in Revenue since last year in Percent"),
  ).describe("Annual Growth"),
  numberOfEmployees: createEstimate(
    z.number().describe("Staff Headcount"),
  ).describe("Staff"),
  numberOfITEmployees: createEstimate(
    z.number().describe("IT Staff Headcount"),
  ).describe("IT Staff"),
  digitalMaturity: createEstimate(
    z.string().describe("Digital Maturity as in low, medium, high"),
  ).describe("Digital Maturity"),
  itSpendInMio: createEstimate(
    z.number().describe("Annual IT Spend in Million Euros"),
  ).describe("IT Spend"),
  industrySpecificConstraints: createEstimate(
    z.array(
      z
        .string()
        .describe(
          "Constraints affecting the company like regulation, legacy IT, unionized workforce, etc",
        ),
    ),
  ).describe("Industry Specific Constraints"),
  markets: createEstimate(markets),
  industries: createEstimate(industries),
});

export const companyNewsSchema = z
  .object({
    domain,
    customerDomain: domain.describe(
      "The originating customer domain for this news item",
    ),
    subjectType,
    source: z
      .string()
      .min(1)
      .max(2048)
      .describe("Public URL of the source"),
    summary: z.string().min(1).describe("Concise summary of the news item"),
    date: z
      .string()
      .min(1)
      .describe("Publication date in ISO 8601 format (YYYY-MM-DD)"),
  })
  .describe("News item about a company");

export const marketAnalysisSchema = z
  .object({
    domain,
    customerDomain: domain.describe(
      "The originating customer domain for this market analysis",
    ),
    subjectType,
    analysis: z
      .string()
      .describe("A complete analysis of the market for the customer"),
  })
  .describe("Market Analysis");

export const competitionAnalysisSchema = z
  .object({
    competitionId: z
      .string()
      .min(1)
      .describe("Stable identifier for the customer + competitor pair"),
    customerDomain: domain,
    competitorDomain: domain,
    customerLegalName: legalName,
    competitorLegalName: legalName,
    analysis: z
      .string()
      .min(1)
      .describe("Competition analysis narrative"),
    summary: z
      .string()
      .min(1)
      .describe("Short bullet summary of the analysis"),
    strengths: z
      .array(z.string().min(1))
      .describe("Strengths for competitor vs customer"),
    weaknesses: z
      .array(z.string().min(1))
      .describe("Weaknesses for competitor vs customer"),
    marketTrends: z
      .array(z.string().min(1))
      .describe("Market trends relevant to the comparison"),
    customerExpectations: z
      .array(z.string().min(1))
      .describe("Customer expectation alignment notes"),
    sources: z
      .array(z.string().min(1))
      .describe("Citations including title, publisher, url, and date"),
  })
  .describe(
    "Competition Analysis comparing a competitor against the customer",
  );

const strategySchema = z
  .object({
    id: z.string().min(1).describe("Stable strategy identifier"),
    name: z.string().min(1).describe("Strategy title"),
    intent: z
      .string()
      .min(1)
      .describe("Why the strategy matters now"),
    competitiveRationale: z
      .string()
      .min(1)
      .describe("Why this helps vs competitors"),
    businessCapabilityImpact: z
      .string()
      .min(1)
      .describe("Business capability uplift"),
    itCapabilityImplications: z
      .string()
      .min(1)
      .describe("IT capability changes implied"),
    riskIfNotPursued: z
      .string()
      .min(1)
      .describe("Risk if the strategy is ignored"),
    timeHorizon: z
      .enum(["short", "mid", "long"])
      .describe("Time horizon for the strategy"),
    evidenceIds: z
      .array(z.string().min(1))
      .min(1)
      .describe("Evidence ids backing the strategy"),
  })
  .describe("Individual IT strategy");

export const itStrategySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "Stable identifier for the IT strategy document (use customer domain)",
      ),
    customerDomain: domain,
    subjectType,
    customerLegalName: legalName,
    strategies: z
      .array(strategySchema)
      .min(1)
      .describe("List of business-driven IT strategies"),
    strengthAmplification: z
      .array(z.string().min(1))
      .describe("Strategies that amplify strengths"),
    weaknessCompensation: z
      .array(z.string().min(1))
      .describe("Strategies that compensate weaknesses"),
    newNicheDifferentiation: z
      .array(z.string().min(1))
      .describe("Strategies to open new niches"),
    sources: z
      .array(z.string().min(1))
      .describe("Citations backing the strategy document"),
  })
  .describe("IT strategy document without selling content");

const serviceMatchSchema = z
  .object({
    strategyName: z
      .string()
      .min(1)
      .describe("Strategy the services align to"),
    supportingServices: z
      .array(z.string().min(1))
      .describe("Services that support the strategy"),
    valueContribution: z
      .string()
      .min(1)
      .describe("Why the service fits the strategy"),
    entryLevelEngagementIdeas: z
      .array(z.string().min(1))
      .describe("Low-risk engagement ideas"),
    gaps: z
      .array(z.string().min(1))
      .describe("Gaps where no service matches"),
  })
  .describe("Service match for a strategy");

export const serviceMatchingSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "Stable identifier for the service matching document (use customer domain)",
      ),
    customerDomain: domain,
    subjectType,
    customerLegalName: legalName,
    itStrategyId: z
      .string()
      .min(1)
      .describe("Identifier of the linked IT strategy"),
    matches: z
      .array(serviceMatchSchema)
      .min(1)
      .describe("Service mappings for each strategy"),
  })
  .describe("Mapping of IT strategies to vendor services");

const strategicImpulseSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("Short title for the impulse"),
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
  })
  .describe("A strategic impulse with WHY/HOW/WHAT reasoning");

const successFactorSchema = z
  .object({
    metric: z
      .string()
      .min(1)
      .describe("The measurable success metric or criterion"),
    howToEnsure: z
      .string()
      .min(1)
      .describe(
        "HOW we ensure this metric is achieved — the concrete mechanism, measurement approach, or validation method that backs this factor",
      ),
  })
  .describe("A success factor with its backing mechanism");

const pocIdeaSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("Short title for the POC"),
    why: z
      .string()
      .min(1)
      .describe(
        "WHY this POC was suggested — what problem or opportunity it addresses, grounded in the customer's specific context and the analysis",
      ),
    how: z
      .string()
      .min(1)
      .describe(
        "HOW to make this POC awesome — the approach, key ingredients, what makes it compelling and low-risk yet impactful",
      ),
    successFactors: z
      .array(successFactorSchema)
      .min(1)
      .describe(
        "Success factors with backing: each factor states the metric AND how we ensure it is achieved",
      ),
    bottomLine: z
      .string()
      .min(1)
      .describe(
        "WHO benefits (customers, partners, internal teams) and HOW if this POC succeeds and gets rolled out as a mature feature. Paint the picture of the end-state value.",
      ),
  })
  .describe("POC idea with WHY/HOW/SUCCESS/BOTTOM-LINE reasoning");

export const salesMeetingPrepSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "Stable identifier for the sales meeting prep document (use customer domain)",
      ),
    customerDomain: domain,
    subjectType,
    customerLegalName: legalName,
    itStrategyId: z
      .string()
      .min(1)
      .describe("Identifier of the linked IT strategy"),
    serviceMatchingId: z
      .string()
      .min(1)
      .describe("Identifier of the linked service matching output"),
    capabilityBaseline: z
      .string()
      .min(1)
      .describe(
        "Assessment of what the customer likely already has in production given their size, digital maturity, industry, and competitive position. This is the floor — all impulses and POCs must go beyond this baseline.",
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
      .array(strategicImpulseSchema)
      .describe("Non-salesy strategic impulses with WHY/HOW/WHAT reasoning"),
    pocIdeas: z
      .array(pocIdeaSchema)
      .describe("Concrete POC ideas with WHY/HOW/SUCCESS reasoning"),
  })
  .describe("Sales meeting preparation output");

// Inferred types
export type CompanyMasterData = z.infer<typeof companyMasterDataSchema>;
export type CompetingCompanies = z.infer<typeof competingCompaniesSchema>;
export type CompanyAssessment = z.infer<typeof companyAssessmentSchema>;
export type CompanyNews = z.infer<typeof companyNewsSchema>;
export type MarketAnalysis = z.infer<typeof marketAnalysisSchema>;
export type CompetitionAnalysis = z.infer<typeof competitionAnalysisSchema>;
export type ITStrategy = z.infer<typeof itStrategySchema>;
export type ServiceMatching = z.infer<typeof serviceMatchingSchema>;
export type SalesMeetingPrep = z.infer<typeof salesMeetingPrepSchema>;
