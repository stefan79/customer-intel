import { callAgent } from "../client.js";
import {
  serviceMatchingSchema,
  type ServiceMatching,
  type ITStrategy,
  type CompanyMasterData,
} from "../schemas.js";

interface ServiceMatchingInput {
  customerDomain: string;
  customerLegalName: string;
  subjectType: "customer" | "competitor";
  itStrategy: ITStrategy;
  companyProfile: CompanyMasterData;
  vendorCatalog: string;
}

export async function generateServiceMatching(
  input: ServiceMatchingInput,
): Promise<ServiceMatching> {
  return callAgent<ServiceMatching>({
        systemPrompt:
      "You are a solution architect at an IT service provider. You align client IT strategies with existing services only.",
    userPrompt: `Context (frozen):
- Customer: ${input.customerLegalName} (${input.customerDomain}) subjectType=${input.subjectType}
- Company profile: ${JSON.stringify(input.companyProfile, null, 2)}
- IT strategies: ${JSON.stringify(input.itStrategy.strategies, null, 2)}

Vendor Service Catalog:
${input.vendorCatalog}

Task:
- For each IT strategy, identify supporting services from the vendor catalog above.
- Explain the value contribution briefly.
- Provide entry-level engagement ideas.
- Call out gaps explicitly when no service matches.

Constraints:
- Do NOT invent services. Only use services from the catalog above.
- Keep rationales short and concrete.
- If no match exists, set supportingServices to [] and gaps to ["no matching service"].

Output format:
- id = "${input.customerDomain}"
- customerDomain = "${input.customerDomain}"
- subjectType = "${input.subjectType}"
- customerLegalName = "${input.customerLegalName}"
- itStrategyId = "${input.itStrategy.id}"
- matches: array of { strategyName, supportingServices, valueContribution, entryLevelEngagementIdeas, gaps }`,
    outputSchema: serviceMatchingSchema,
    outputToolName: "save_service_matching",
    outputToolDescription: "Save the structured service matching results",
    useWebSearch: false,
  });
}
