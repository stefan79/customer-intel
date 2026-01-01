# IT Strategy + Service Matching + Sales Meeting Spec (Draft)

Goal
- Add three explicit phases after comparative market analysis: IT strategy, service matching, and sales meeting prep.
- Keep each phase isolated with frozen inputs and a dedicated handler.
- Preserve phase boundaries to avoid mixing analysis, strategy, and selling.

Scope
- Phase 0 (normalize + freeze inputs) is already done.
- Phase 1.5 (strategy quality gate) is intentionally skipped for now.
- This spec only defines phases 1-3 and their data, handlers, and queue contracts.

Pipeline (High Level)
[Company + Competitor Intelligence]
        ↓
[Comparative Market Analysis]
        ↓
[IT Strategy Synthesis]          ← Phase 1 (no selling)
        ↓
[Service Matching]               ← Phase 2 (controlled selling)
        ↓
[Sales Meeting Preparation]      ← Phase 3 (human-facing)

High-Level Data Inputs (by Phase)
Phase 1 (IT Strategy)
- Company master data (profile + core attributes)
- Company market analysis (from master data reference)
- Competition analysis (from master data reference)
- Weaviate evidence snippets (customer + select competitors)
- Web search for validation and missing citations

Phase 2 (Service Matching)
- IT strategy output
- Vendor catalog (private, via OpenAI vector store id)

Phase 3 (Sales Meeting Prep)
- IT strategy output
- Service matching output
- Company master data (profile + key context)

Phase Boundaries
- Each phase has:
  - clear input payload
  - explicit output schema
  - a unique handler
  - no cross-phase prompt blending

Collections (Weaviate)
1) ITStrategy
2) ServiceMatching
3) SalesMeetingPrep

Model Registry Sketch (snippet)
```js
itStrategy: generateModelRegistryEntry(itStrategy, IT_STRATEGY_COLLECTION, "id"),
serviceMatching: generateModelRegistryEntry(serviceMatching, SERVICE_MATCHING_COLLECTION, "id"),
salesMeetingPrep: generateModelRegistryEntry(salesMeetingPrep, SALES_MEETING_PREP_COLLECTION, "id"),
```

Common Request Fields (All Phases)
- `customerDomain` (string, required)
- `subjectType` ("customer" | "competitor", required)

Phase 1: IT Strategy Generation (NO selling)
Trigger
- Manual trigger only: user initiates a direct Lambda call to start Phase 1.
- The handler loads all required context from master data references and Weaviate.
- Phase 1 enqueues Phase 2 on success; Phase 2 and Phase 3 are automatic via queues.
- Phase 1 loads the customer master data via Weaviate and enriches downstream payloads with derived fields (e.g., `customerLegalName`).

Handler
- New queue consumer: `src/handler/itstrategy/subscribe.downstream.js`

Input (Queue Payload)
{
  "customerDomain": "...",
  "subjectType": "customer"
}

Output Schema (Weaviate: ITStrategy)
- `customerDomain` (string, required)
- `subjectType` (string, required)
- `customerLegalName` (string, required)
- `strategies` (array, required)
  - `name`
  - `intent`
  - `competitiveRationale`
  - `businessCapabilityImpact`
  - `itCapabilityImplications`
  - `riskIfNotPursued`
  - `timeHorizon` ("short" | "mid" | "long")
- `strengthAmplification` (array of strategy ids or names)
- `weaknessCompensation` (array of strategy ids or names)
- `newNicheDifferentiation` (array of strategy ids or names)
- `sources` (array of strings, optional)

Prompt Constraints
- Business-driven strategies only.
- No vendors, no solutioning, no selling language.
- Each strategy must be traceable to evidence from inputs.

Prompt (Phase 1)
ROLE
You are a senior enterprise IT strategist advising the executive board.
You are NOT selling services.
You are NOT proposing vendors.
You focus on business-driven IT strategy.

INPUTS
1) Company master data (customer profile + attributes)
2) Company market analysis (customer)
3) Competition analysis (customer vs competitors)
4) Evidence excerpts pulled from Weaviate (see data retrieval below)

TASK
Derive IT strategies that:
- strengthen competitive advantages
- compensate structural weaknesses
- enable entry into adjacent or new niches

CONSTRAINTS
- Strategies must be business-driven, not technology-driven.
- Each strategy must cite a supporting evidence excerpt id.
- Avoid generic buzzwords.
- No vendor references.
- No solution descriptions.

OUTPUT FORMAT
For each strategy:
- Strategy name
- Strategic intent (why this matters now)
- Competitive rationale (vs competitors)
- Business capability impact
- IT capability implications
- Risk if not pursued
- Time horizon (short / mid / long)
- Evidence ids (array)

OUTPUT SECTIONS
1) Strength amplification strategies
2) Weakness compensation strategies
3) New niche / differentiation strategies

Tools (Phase 1)
- Weaviate + web_search. Do not use file_search in Phase 1.
- Use `getClient()` from `src/weaviate.js` and the model registry for fetch/insert.

Weaviate Data Retrieval (Phase 1)
1) Load master data first:
   - Company master data via `Model.companyMasterData.fetchObject(wv, customerDomain)`
2) From master data references, load:
   - MarketAnalysis (`companyMasterData.marketAnalysis`)
   - CompetitionAnalysis (`companyMasterData.competitionAnalysis`)
3) Retrieve supporting evidence snippets:
   - Collection: `MarketAnalysis`
   - Query text:
     "Evidence for IT strategy: competitive strengths/weaknesses, market positioning, trend alignment, innovation posture, customer expectations."
   - Use default vector search with a limit of 8.
   - Filter by `domain == customerDomain`.
4) If competition analysis includes competitor domains, optionally fetch:
   - 1-2 MarketAnalysis objects per competitor (same query text, filter by competitor domain, limit 2 each).

Context Enrichment (Phase 1)
- Build a frozen context object:
  - `companyProfile` (from master data)
  - `companyMarketAnalysis` (from market analysis object)
  - `competitionAnalysis` (from competition analysis object)
  - `evidence` (array of snippets with ids, source labels, and short text)
- Deduplicate evidence by source/url, and cap evidence array to 12 items.
- Attach evidence ids to strategies to keep traceability.

Phase 2: Service Matching (controlled selling)
Trigger
- Triggered by the Phase 1 handler via queue on success.
- The handler checks Weaviate for an existing ServiceMatching document.
  - If missing, generate and store it.
  - If present, skip regeneration.
  - Always enqueue the Phase 3 request downstream (dev behavior).

Handler
- New queue consumer: `src/handler/servicematching/subscribe.downstream.js`

Vendor Description (private)
- Vendor/service catalog should NOT be committed to the repo.
- Upload the catalog to OpenAI file store, create a vector store, and keep only the vector store id in SST config.
- Proposed SST config wiring:
  - `sst.Secret("VendorCatalogVectorStoreId")`
  - Access in handler via `Resource.VendorCatalogVectorStoreId.value`.

Input (Queue Payload)
{
  "customerDomain": "...",
  "subjectType": "customer",
  "customerLegalName": "...",
  "itStrategyId": "...",
  "vendorCatalogVectorStoreId": "<from Resource or env>"
}

Output Schema (Weaviate: ServiceMatching)
- `customerDomain` (string, required)
- `subjectType` (string, required)
- `customerLegalName` (string, required)
- `itStrategyId` (string, required)
- `matches` (array, required)
  - `strategyName`
  - `supportingServices` (array of service names)
  - `valueContribution` (string)
  - `entryLevelEngagementIdeas` (array of strings)
  - `gaps` (array of strings, optional)

Prompt Constraints
- Do not invent services.
- Do not force-fit; state when no service matches.
- Keep rationales short and concrete.

Prompt (Phase 2)
ROLE
You are a solution architect at an IT service provider.
You align client IT strategies with suitable service offerings.
You do NOT invent services.

INPUTS
1) Approved IT strategy document (from Weaviate)
2) Vendor catalog context (from OpenAI vector store file_search)
3) Company master data (customer profile + constraints)

TASK
For each IT strategy:
- Identify which services support it
- Explain why the service fits
- Identify gaps where no service exists

CONSTRAINTS
- Do not force-fit services.
- Keep mapping rationale short and concrete.
- If no match, explicitly state "no matching service."
- No new services; only those retrieved from vendor catalog.

OUTPUT FORMAT
For each IT strategy:
- Supporting services (array)
- Value contribution (short)
- Entry-level engagement ideas (bullets)
- Gaps (if any)

Tools (Phase 2)
- Use `file_search` with the vendor catalog vector store id.
- Do not use web_search in Phase 2.
- Weaviate is used only to fetch ITStrategy and CompanyMasterData.
- Use `getClient()` from `src/weaviate.js` and the model registry for fetch/insert.

Context Retrieval (Phase 2)
1) Load master data first:
   - Company master data via `Model.companyMasterData.fetchObject(wv, customerDomain)`
2) Load ITStrategy:
   - ITStrategy via `Model.itStrategy.fetchObject(wv, itStrategyId)`
3) Retrieve vendor catalog context:
   - Use `file_search` against `vendorCatalogVectorStoreId`
   - Query text:
     "Match services to IT strategies. Return relevant service descriptions, prerequisites, typical POCs, and industries."
   - Limit to 8-12 excerpts; prefer concise entries with clear service names.

Context Enrichment (Phase 2)
- Build a frozen context object:
  - `companyProfile` (from master data)
  - `itStrategies` (from ITStrategy)
  - `vendorServices` (array of retrieved catalog excerpts with service names)
- Deduplicate vendor excerpts by service name and cap at 12 entries.
- Pass only the selected excerpts to the prompt to keep it focused.

Phase 3: Sales Meeting Preparation (human-centric)
Trigger
- Triggered by the Phase 2 handler via queue on success.
- The handler checks Weaviate for an existing SalesMeetingPrep document.
  - If missing, generate and store it.
  - If present, skip regeneration.
  - Always enqueue any downstream requests if added later (dev behavior).

Handler
- New queue consumer: `src/handler/salesmeetingprep/subscribe.downstream.js`

Input (Queue Payload)
{
  "customerDomain": "...",
  "subjectType": "customer",
  "customerLegalName": "...",
  "itStrategyId": "...",
  "serviceMatchingId": "..."
}

Output Schema (Weaviate: SalesMeetingPrep)
- `customerDomain` (string, required)
- `subjectType` (string, required)
- `customerLegalName` (string, required)
- `executiveBriefing` (string)
- `strategicHypotheses` (array of strings)
- `questionsToAsk` (array of strings)
- `strategicImpulses` (array of strings)
- `pocIdeas` (array)
  - `objective`
  - `scope`
  - `successCriteria`

Prompt Constraints
- No generic sales language.
- Every question should map back to an IT strategy.
- POCs must be low-risk and exploratory.

Prompt (Phase 3)
ROLE
You are a senior sales engineer preparing a first executive meeting.
Your goal is insight, trust, and curiosity, not closing.

INPUTS
1) Company master data (customer profile + constraints)
2) IT strategy document (approved)
3) Service matching output

TASK
Prepare a sales meeting briefing that includes:
- Context executives must know
- Hypotheses to test (not claims)
- Smart questions to ask
- Strategic impulses to propose
- Concrete POC ideas

CONSTRAINTS
- No generic sales language.
- Each question must link to a specific strategy.
- POCs must be low-risk and exploratory.
- Do not introduce services not present in service matching output.

OUTPUT SECTIONS
1) Executive briefing (1 page)
2) Strategic hypotheses
3) Questions to ask (grouped by theme)
4) Strategic impulses (what to suggest, not sell)
5) POC ideas (objective, scope, success criteria)

Tools (Phase 3)
- Weaviate only. Do not use web_search or file_search in Phase 3.
- Weaviate is used to fetch CompanyMasterData, ITStrategy, and ServiceMatching.
- Use `getClient()` from `src/weaviate.js` and the model registry for fetch/insert.

Context Retrieval (Phase 3)
1) Load master data:
   - Company master data via `Model.companyMasterData.fetchObject(wv, customerDomain)`
2) Load ITStrategy:
   - ITStrategy via `Model.itStrategy.fetchObject(wv, itStrategyId)`
3) Load ServiceMatching:
   - ServiceMatching via `Model.serviceMatching.fetchObject(wv, serviceMatchingId)`

Context Enrichment (Phase 3)
- Build a frozen context object:
  - `companyProfile` (from master data)
  - `itStrategies` (from ITStrategy)
  - `serviceMatches` (from ServiceMatching)
- Keep only the top 3-5 strategies based on relevance to meeting objectives.
- Ensure every hypothesis and question is traceable to a strategy id.

Handler/Command Updates (by file)
- `src/model.js`
  - Add Zod schemas + registry entries for ITStrategy, ServiceMatching, SalesMeetingPrep.
  - Add references on `companyMasterData` to link the three collections.
- `src/cmd/generateITStrategy.js`
  - Generator for Phase 1 (uses structured output format).
- `src/cmd/generateServiceMatching.js`
  - Generator for Phase 2 (uses file_search on vendor catalog vector store).
- `src/cmd/generateSalesMeetingPrep.js`
  - Generator for Phase 3 (uses structured output format).
- `src/handler/itstrategy/subscribe.downstream.js`
- `src/handler/servicematching/subscribe.downstream.js`
- `src/handler/salesmeetingprep/subscribe.downstream.js`

Queue Wiring (SST)
- Add three queues and downstream subscriptions with dedicated DLQs.
- Each handler must be linked to required secrets/resources:
  - `VendorCatalogVectorStoreId` (phase 2 only).
- Ensure queue payloads always carry `customerDomain` and `subjectType`.

Notes / Decisions
- Phase 1.5 is excluded from this spec by design.
- Phase 2 requires vendor catalog via vector store id only; no catalog contents in repo.
- Keep each phase output stored in Weaviate and linked to `CompanyMasterData`.
