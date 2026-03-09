import { z } from "zod";
import { callAgent } from "../client.js";
import { companyNewsSchema, type CompanyNews } from "../schemas.js";

interface NewsInput {
  domain: string;
  customerDomain: string;
  legalName: string;
  subjectType: "customer" | "competitor";
}

// Wrapper schema for array output via tool_use
const newsListSchema = z.object({
  items: z.array(companyNewsSchema).describe("List of news items"),
});

export async function generateNews(
  input: NewsInput,
): Promise<CompanyNews[]> {
  const result = await callAgent({
        systemPrompt:
      "You are a research assistant to help prepare customer meetings.",
    userPrompt: `Task:
Search the public internet for news about the company "${input.legalName}" (domain: ${input.domain}).

Focus areas:
- Organizational changes (leadership, restructuring, M&A, hiring/firing initiatives)
- Announcements of new products, goods, or services
- Retrospectives or post-mortems on major initiatives
- Roadmap or strategic announcements
- IT-related updates (platform changes, major system rollouts, cloud migration, cybersecurity events)

Source rules:
- Use public, non-paywalled sources only (company website, press releases, blogs, reputable media).
- Avoid low-quality listicles or scraped aggregators.

Output rules:
- Return up to 12 items.
- Only include items with a clear publication date.
- Do not include duplicates or multiple entries for the same source URL.
- Set "domain" to "${input.domain}" for every item.
- Set "customerDomain" to "${input.customerDomain}" and "subjectType" to "${input.subjectType}" for every item.
- Keep each summary to <= 600 characters.
- Return structured data only; no prose or explanations.`,
    outputSchema: newsListSchema,
    outputToolName: "save_news",
    outputToolDescription: "Save the structured news items",
    useWebSearch: true,
  });

  return result.items;
}
