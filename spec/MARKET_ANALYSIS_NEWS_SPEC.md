# Market Analysis + News Signals + Competitor Processing Spec (Draft)

Goal
- Include company news signals in market analysis using the `vectorStoreId` derived upstream and passed along with the request.
- Process competitors in the exact same pipeline as customers (no dedicated competitor pipeline).
- Distinguish whether processing is for the customer or a competitor using `subjectType` and `customerDomain`.
- Extend request payloads to include `customerDomain` (current behavior: same as `domain`).
- Comparing competitors to each other is out of scope for this request.

Current Flow (simplified)
- Master data -> assessment -> competition -> news fanout -> vector store batch -> market analysis (via polling).
- For each competitor found in competition:
  - Master data -> assessment -> news fanout -> vector store batch -> market analysis (via polling).
- Market analysis request currently assumes the subject is the customer (no explicit customer/competitor identity).

Proposed Flow
1) Unified pipeline (customer + competitors):
   - Assessment
   - News fanout
   - Market analysis uses `vectorStoreId` for news signals
   - Each request carries `subjectType` and `customerDomain` to mark the subject.
   - For competitors, skip the competition step (do not search for competitors of competitors).

Payload Changes (all queues/handlers in pipeline)
- Add `customerDomain` to all request payloads that currently carry `domain`; it must always be included and preserved.
- Add `subjectType` (enum: `customer` | `competitor`) as an explicit marker for downstream processing.
- The `domain` may vary (competitor pipelines), but `customerDomain` stays the original customer.

Market Analysis Request (expanded)
Current:
{
  "legalName": "...",
  "domain": "...",
  "industries": [...],
  "markets": [...],
  "vectorStoreId": "vs_..."
}

Proposed:
{
  "customerDomain": "...",
  "domain": "...",
  "legalName": "...",
  "industries": [...],
  "markets": [...],
  "vectorStoreId": "vs_...",
  "subjectType": "customer" | "competitor"
}

News Fanout Request (expanded)
Current:
{
  "legalCompanyName": "...",
  "domain": "..."
}

Proposed:
{
  "customerDomain": "...",
  "legalCompanyName": "...",
  "domain": "...",
  "subjectType": "customer" | "competitor"
}

Assessment Request (expanded)
Current:
{
  "legalName": "...",
  "domain": "..."
}

Proposed:
{
  "customerDomain": "...",
  "legalName": "...",
  "domain": "...",
  "subjectType": "customer" | "competitor"
}

Competitor Processing (out of scope)
- Competitors are analyzed with the same pipeline as customers.
- There is no separate competitor pipeline.
- Competitor-to-competitor comparison is out of scope for now; we will add this later.

Market Analysis Prompt (updated)
- Add instructions to incorporate news signals from the vector store:
  - Use the OpenAI file search tool with `vectorStoreId` to retrieve recent news snippets and treat them as signals.
  - Limit to the 10 most relevant signals based on recency and relevance (prefer items from the last 90 days).
  - Clearly separate facts from inferred signals.
  - Use default OpenAI tool behavior only (no custom retrieval logic).

File Search Implementation Suggestion (OpenAI default tools)
- Use the Responses API with the built-in `file_search` tool and pass the vector store id:
  - `tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }]`
  - Prompt the model to call `file_search` before composing the response.
  - Prompt the model to select the 10 most relevant and recent snippets from tool results.
- Keep this as a prompt-level instruction (no custom ranking/filtering code).
- Add role context:
  - If `subjectType === "competitor"`, frame analysis as competitor market context.
  - If `subjectType === "customer"`, keep the current framing.

Handler/Command Updates (by file)
- `src/cmd/generateMarketAnalysis.js`
  - Extend request schema to include `customerDomain` and `subjectType`.
  - Update prompt to include news signals from vector store.
- File search integration
  - Use the OpenAI Responses API with the `file_search` tool configured to the `vectorStoreId`.
  - Limit file search results to 10 and bias toward recency and relevance.
  - Inject retrieved snippets into a dedicated “Signals” section of the prompt.
  - Enforce that signals are cited as such and kept separate from verified facts.
- `src/cmd/retrieveMarketAnalysis.js` (if used for vector store queries)
  - Add vector store query to fetch news signals by `vectorStoreId`.
- `src/handler/marketanalysis/subscribe.downstream.js`
  - Accept `customerDomain` and `subjectType`.
  - Decide how to store/link analysis: customer vs competitor.
  - If analysis already exists, skip generation but still enqueue downstream competition analysis attempt.
- `src/handler/news/subscribe.fanout.js`
  - Pass through `customerDomain` and `subjectType`.
- `src/handler/assessment/subscribe.downstream.js`
  - Pass through `customerDomain` and `subjectType`.
  - Do not enqueue MarketAnalysis directly for customer (already removed).
- `src/handler/competition/subscribe.downstream.js`
  - No changes in this phase (competitor fanout deferred).
- `src/handler/loadintovectorstore/subscribe.poll.js`
  - Preserve `customerDomain` in context passed to Step Functions.

Weaviate / Model Notes
- Reuse existing collections for customer and competitor data (no separate collections).
- Add a `competingCompanies` reference on `companyMasterData` to link customer -> competitor master data entries.
- `competingCompanies` is the source property and points to `CompanyMasterData` within the same collection.
- Only link from customer to competitor (no competitor-to-competitor or competitor-to-customer links).
- If a competitor master data entry is missing, create it and link it to the customer entry.
- Consider adding `customerDomain` and `subjectType` as properties where needed to support filtering.
- Update the model registry reference map:
  - `competingCompanies: COMPANY_MASTER_DATA_COLLECTION`
  - Link with `Model.companyMasterData.linkObjects(wv, "competingCompanies", customerMaster, competitorMaster)`.

Downstream Routing
- `subjectType` is the explicit marker for downstream processing decisions.
- For this phase, market analysis runs for both, but any post-analysis actions should branch on `subjectType`.

Propagation Map
- `customerDomain` and `subjectType` must be preserved across:
  - `AssessmentQueue` -> `src/handler/assessment/subscribe.downstream.js`
  - `NewsQueue` -> `src/handler/news/subscribe.fanout.js`
  - `DownloadQueue` -> `src/handler/loadintovectorstore/subscribe.poll.js`
  - `VectorStoreBatchFlow` -> `src/handler/loadintovectorstore/check.batch.js`
  - `MarketAnalysisQueue` -> `src/handler/marketanalysis/subscribe.downstream.js`
- `vectorStoreId` for news and market analysis is derived upstream from the domain name and passed along (no alternate sources).
- Once `vectorStoreId` is introduced, it must be preserved end-to-end through the pipeline.

Questions / Clarifications
Resolved Decisions
- Include `subjectType` explicitly (`customer` or `competitor`) and use it as the marker for downstream processing.
- Reuse the same vector store namespace; competitor domains keep data separated.
- Use the same collections for customer and competitor data.
- Competitors are processed in the same pipeline as customers (no separate competitor pipeline).
- Competitor-to-competitor comparison is out of scope for now (we will add this later).
- Trigger competitor processing immediately.

Verification
- Run `pnpm run lint`.
- Update `AGENTS.md` and `README.md` after implementation to reflect the new pipeline and payload changes.
