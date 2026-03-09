import { callAgent } from "../client.js";
import { companyMasterDataSchema, type CompanyMasterData } from "../schemas.js";

interface MasterDataInput {
  domain: string;
  name: string;
}

export async function generateMasterData(
  input: MasterDataInput,
): Promise<CompanyMasterData> {
  return callAgent<CompanyMasterData>({
    systemPrompt:
      "You are a research assistant to help prepare customer meetings.",
    userPrompt: `Task:
Look up and verify master data for the company: ${input.name} and the domain ${input.domain}.

Objectives:
- Retrieve accurate, up-to-date master data from authoritative public sources.
- Prefer primary sources (official company website, annual report, filings, press releases).
- Use secondary sources (business databases, reputable news) only to confirm or fill gaps.
- Resolve conflicting information by citing the most reliable source and explaining the choice.

Method:
1. Identify the company's official web presence via the given domain
2. Cross-check key facts with at least one independent, reputable source.
3. If data is missing or uncertain, provide best estimates and note uncertainty.
4. Avoid speculative or promotional language.

Output:
- Return the collected master data as structured factual content only.
- Do not invent values.
- Do not include schema descriptions or explanations of formatting.`,
    outputSchema: companyMasterDataSchema,
    outputToolName: "save_master_data",
    outputToolDescription: "Save the structured company master data",
    useWebSearch: true,
  });
}
