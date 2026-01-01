# Competition Analysis Spec (Draft)

Goal
- For each competitor market analysis generated, create a competition analysis report comparing the competitor with the customer.
- Use Weaviate queries/embeddings for context, include news signals via vector store ids, and allow OpenAI web_search.
- Store the competition analysis in Weaviate and vectorize it.
- Link the analysis to the customer's master data and include competitor domain in the analysis object.

Scope
- This spec focuses on the competition analysis report generation and storage.
- It does not change how competitors are discovered (assumed already available).

Trigger
- The trigger is completion of a competitor market analysis.
- After a competitor market analysis is generated, enqueue a competition analysis job.
- The job payload must include both the customer and competitor identifiers.

Data Model (Weaviate)
- New collection: `CompetitionAnalysis`
- Stored object must include:
  - `customerDomain` (string, required)
  - `competitorDomain` (string, required)
  - `customerLegalName` (string, required)
  - `competitorLegalName` (string, required)
  - `analysis` (string, required)
  - `summary` (string, required)
  - `strengths` (array of string)
  - `weaknesses` (array of string)
  - `marketTrends` (array of string)
  - `customerExpectations` (array of string)
  - `sources` (array of string, each entry includes title + publisher + url + date)
- Vectorization:
  - CompetitionAnalysis uses only the default managed vector (no custom vector names).
  - MarketAnalysis uses two vectors:
    - Default managed vector (Weaviate-managed).
    - A self-provided vector for competition-focused retrieval (ex: `competitionAnalysisLense`).
  - Extend the model/collection creation logic to support mixed vectorization:
    - Add a managed vectorizer config for MarketAnalysis and CompetitionAnalysis.
    - Keep `vectors.selfProvided` for the MarketAnalysis competition lens.
    - Update insert logic to provide the competition lens vector when storing MarketAnalysis.

Model Registry Sketch (snippet)
```js
// MarketAnalysis: managed default + competitionAnalysisLense (self-provided)
marketAnalysis: generateModelRegistryEntry(
  marketAnalysis,
  MARKET_ANALYSIS_COLLECTION,
  "domain",
  {},
  ["competitionAnalysisLense"],
  { managed: true }
),

// CompetitionAnalysis: managed default only
competitionAnalysis: generateModelRegistryEntry(
  competitionAnalysis,
  COMPETITION_ANALYSIS_COLLECTION,
  "id",
  {},
  [],
  { managed: true }
)
```
Notes:
- This requires extending `generateModelRegistryEntry` to accept a managed vectorizer config.
- The managed vectorizer config must be compatible with existing collection creation and references.
- References:
  - Link `CompetitionAnalysis` to the customer's `CompanyMasterData` using a reference property (ex: `competitionAnalysis`).
  - Add a `competitionMasterData` reference on `CompetitionAnalysis` pointing to the competitor's `CompanyMasterData`.
  - Store `competitorDomain` inside the analysis object (required).

Request Payload (Queue)
{
  "customerDomain": "...",
  "competitorDomain": "...",
  "customerLegalName": "...",
  "competitorLegalName": "...",
  "customerVectorStoreId": "...",
  "competitorVectorStoreId": "...",
  "customerMarketAnalysisId": "...",
  "competitorMarketAnalysisId": "..."
}

Weaviate Context Retrieval
- Fetch customer and competitor market analysis objects via Weaviate using their ids.
- Use embeddings/nearVector queries in `MarketAnalysis` to pull supporting evidence.
  - Query text (embed once and reuse): "Compare competitive strengths and weaknesses, niche positioning, market trends, and customer expectations for customer vs competitor."
  - Use the MarketAnalysis competition lens vector (`competitionAnalysisLense`) with a limit of 5 results per subject, filtered by `domain`.
  - Filter: `domain == customerDomain` for customer context and `domain == competitorDomain` for competitor context.
- Use default Weaviate vector search when retrieving prior competition analysis context.
- Pull news signals via OpenAI file_search using:
  - `customerVectorStoreId`
  - `competitorVectorStoreId`

OpenAI Prompt (proposal)
Instructions:
- You are a competitive analyst. Compare the competitor with the customer.
- Use file_search for news signals from both vector stores before writing.
- Use web_search to validate facts and gather missing citations.
- Use Weaviate evidence (market analysis embeddings + retrieved context) to ground the comparison.
- Separate facts from inferred insights.

Input block:
Customer:
- Name: <%= req.customerLegalName %>
- Domain: <%= req.customerDomain %>
- Market analysis: <%= req.customerMarketAnalysis %>
Competitor:
- Name: <%= req.competitorLegalName %>
- Domain: <%= req.competitorDomain %>
- Market analysis: <%= req.competitorMarketAnalysis %>

Required sections (structured output):
1) Summary (short, 5-8 bullets)
2) Strengths (competitor vs customer; list)
3) Weaknesses (competitor vs customer; list)
4) Niche positioning comparison (short narrative)
5) Market trends impact (list + short narrative)
6) Customer expectations alignment (list + short narrative)
7) Sources (title, publisher, url, date)

Output rules:
- Return JSON only matching the schema.
- Escape newlines/tabs in strings.
- Keep `analysis` under 3500 chars, `summary` under 1200 chars.

Embedding Instructions
- Only MarketAnalysis needs a self-provided embedding for `competitionAnalysisLense`.
- CompetitionAnalysis uses Weaviate-managed vectors only.
- Embedding command behavior (for `competitionAnalysisLense`):
  - Basic chunking: split on paragraph boundaries, cap at ~1200 chars per chunk.
  - Embed this text per chunk:
    - `Evidence: <news snippets + key market analysis excerpts>. Task: compare strengths, weaknesses, niches, trends, and expectations for customer vs competitor.`
  - Average chunk embeddings and attach to `MarketAnalysis.vectors.competitionAnalysisLense` when inserting/updating.

Handler/Command Updates (by file)
- `src/model.js`
  - Add `competitionAnalysis` schema and registry entry.
  - Add reference map entry on `companyMasterData` for competition analysis.
  - Extend `generateModelRegistryEntry` to accept a managed vectorizer config and keep existing reference behavior intact.
- `src/cmd/generateCompetitionAnalysis.js`
  - New generator using file_search (both vector stores) + web_search + Weaviate evidence.
  - Uses structured output schema.
- `src/cmd/generateCompetitionAnalysisEmbedding.js`
  - New embedding command for `competitionAnalysisLense`.
  - Performs basic chunking (split by paragraph boundaries, cap at ~1200 chars) and averages vectors.
  - Embeds the following text per chunk:
    - `Evidence: <news snippets + key market analysis excerpts>. Task: compare strengths, weaknesses, niches, trends, and expectations for customer vs competitor.`
- `src/handler/competition/subscribe.downstream.js` (or new handler)
  - Enqueue competition analysis job after competitor market analysis exists.
- `src/handler/competitionanalysis/subscribe.downstream.js`
  - Validate request, load context from Weaviate, call generator, store analysis, link to customer master data.

Linking
- Use `Model.companyMasterData.linkObjects(wv, "competitionAnalysis", customerMaster, competitionAnalysis)`.
- Link `CompetitionAnalysis` to the competitor master data via `competitionMasterData`.
- Store `competitorDomain` on the analysis object to enable filtering without map references.
- Enforce a single analysis per customer/competitor pair (no versioning).

Summary / Decisions
- Competition analysis runs only after both customer and competitor market analyses exist.
- Keep file_search for news signals only; avoid custom retrieval logic.
- Persist `competitorDomain` as a property (no map references), and keep bidirectional links:
  - customer master data -> competition analysis
  - competition analysis -> competitor master data
- Single analysis per customer/competitor pair (no versioning).
