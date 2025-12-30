import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { fetchObject, insertObject } from "./weaviate";

export const legalName = z.string().min(1).max(255).describe("The complete legal name of the company")
export const domain = z.string().min(1).max(255).describe("The main domain of the company homepage in the format of name.tld")
export const markets = z.array(
  z.string().min(2).max(2).describe("ISO 3166-1 alpha-2 country code, or glaobal in case of a glabal acting entity"),
).describe("Primary markets generating >= 80% of revenue");
export const industries = z.array(
  z.string().min(1).max(255).describe("Industry name"),
).describe("Verticals, Business Models, Value Chains the company is active in")
export const revenueInMio = z.number().describe("Annual Revenue in Million Euros")

function createEstimate(field) {
  return z.object({
    value: field,
    source: z.string().min(1).describe("How the estimate / data entry was determined."),
    citation: z.string().min(1).describe("URL of the source"),
    date: z.coerce.date().describe("Date on which the estimate / data entry was determined on"),
    confidence: z.number().min(0).max(1).describe("1 if the specific value was found, otherwise the confidence of your estimate."),
  })
}

const companyMasterDataSchema = z.object({
  domain,
  legalName,
  countryCode: z.string().min(1).max(255).describe("The ISO country code of the company residence"),
  address: z.object({
    street: z.string().min(1).max(255),
    city: z.string().min(1).max(255),
    region: z.string().min(1).max(255),
    postalCode: z.string().min(1).max(255),
    country: z.string().min(1).max(255),
  }).describe("The Headquarters of the Company"),
}).describe("Master Data for a company ");


const competingCompaniesSchema = z.object({
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
}).describe(
  "A collection of competing companies (referenced in the list competition) for a specific potential customer (referenced by domain and legalName )",
);

const companyAssessment = z.object({
  domain,
  revenueInMio: createEstimate(revenueInMio).describe("Annual Revenue"),
  revenueGrowth: createEstimate(z.number().describe("Annual Growth in Revenue since last year in Percent")).describe("Annual Growth"),
  numberOfEmployees: createEstimate(z.number().describe("Staff Headcount")).describe("Staff"),
  numberOfITEmployees: createEstimate(z.number().describe("IT Staff Headcount")).describe("IT Staff"),
  digitalMaturity: createEstimate(z.string().describe("Digital Maturity as in low, medium, high")).describe("Digital Maturity"),
  itSpendInMio: createEstimate(z.number().describe("Annual IT Spend in Million Euros")).describe("IT Spend"),
  industrySpecificConstraints: createEstimate(z.array(
    z.string().describe("Constraints affecting the company like regulation, legacy IT, unionized workforce, etc")
  )).describe("Industry Specifric Constraints"),
  markets: createEstimate(markets),
  industries: createEstimate(industries),
})

const marketAnalysis = z.object({
  domain,
  analysis: z.string().describe("A complete anlaysis of the market for the customer")
}).describe("Market Analysis")


const generateModelRegistryEntry = (zodSchema, collectionName, idName) => {
  return {
    openAIFormat: {
      text: {
        format: zodTextFormat(zodSchema, collectionName),
      },
    },
    fetchObject: async (client, id) => {
      return fetchObject(client, id, collectionName)
    },
    insertObject: async (client, properties) => {
      return insertObject(client, properties[idName], properties, collectionName)
    },
    validate: (obj) => {
      return zodSchema.parse(obj)
    },
    zodSchema,
    collectionName,
  };
};

export default {
  companyMasterData: generateModelRegistryEntry(
    companyMasterDataSchema,
    "CompanyMasterData",
    "domain",
  ),
  competingCompanies: generateModelRegistryEntry(
    competingCompaniesSchema,
    "CompetingCompanies",
    "customerDomain",
  ),
  companyAssessment: generateModelRegistryEntry(
    companyAssessment,
    "CompanyAssessment",
    "domain",
  ),
  marketAnalysis: generateModelRegistryEntry(
    marketAnalysis,
    "MarketAnalysis",
    "domain",
  ),
};


export const LookupCompanyMasterDataRequest = z.object({
  company: z.string().min(1),
});
