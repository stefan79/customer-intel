# Customer Intel

Customer Intel processes company data through SST-managed queues and Lambdas to enrich Weaviate collections, run OpenAI generations, and populate vector stores for downstream research.

## Prerequisites
- Node.js 18+ and `pnpm` installed.
- AWS credentials configured for your target stage.
- Secrets set via SST for each stage:
  - `OpenAIApiKey`
  - `WeaviateAPIKey`
- The Weaviate endpoint is defined in `sst.config.ts` and passed to functions through `environment`.

## Installation
```bash
pnpm install
```

## Secrets and environment
Set secrets per stage before running `sst dev` or deploying:
```bash
pnpm dlx sst secrets set --stage <stage> OpenAIApiKey <value>
pnpm dlx sst secrets set --stage <stage> WeaviateAPIKey <value>
```

## Local development
- Lint the code and EJS templates:
  ```bash
  pnpm lint
  pnpm lint:ejs
  ```
- Start the SST dev environment (using `pnpx` via `pnpm dlx`):
  ```bash
  pnpm dlx sst dev --stage <stage>
  ```
- Deploy to a stage:
  ```bash
  pnpm dlx sst deploy --stage <stage>
  ```

## Processing flow
1. **Master data entrypoint** (`src/handler/masterdata/call.downstream.js`, `MasterDataCallDownStreamHandler`): validates the request (including `customerDomain` + `subjectType`, defaulting to a `customer`), generates company master data via OpenAI when missing, stores it in Weaviate, and enqueues the enriched request on `AssessmentQueue`.
2. **Assessment subscriber** (`src/handler/assessment/subscribe.downstream.js`): fetches or generates an assessment, links it to master data, and fans out:
   - **CompetitionQueue** payload (customers only) extends the request with `revenueInMio`, `industries`, and `markets` from the assessment.
   - **NewsQueue** payload carries `customerDomain`, `domain`, `legalCompanyName`, and `subjectType` for news discovery.
3. **Competition subscriber** (`src/handler/competition/subscribe.downstream.js`): fetches or generates competing companies, ensures competitor master data exists, links the customer to competitors via `competingCompanies`, and enqueues competitor assessments (`subjectType=competitor`) on `AssessmentQueue` without triggering further competition searches.
4. **News fanout subscriber** (`src/handler/news/subscribe.fanout.js`): generates company news items (annotated with `customerDomain` and `subjectType`), stores new entries, and sends downloadable sources to `DownloadQueue` with `{ customerDomain, domain, subjectType, url, fallback, vectorStore: "news/<domain>", type: "news" }`.
5. **Vector store loader** (`src/handler/loadintovectorstore/subscribe.poll.js`): downloads each URL (or builds markdown fallbacks), uploads files to OpenAI, ensures the target vector store exists, and starts the `VectorStoreBatchFlow` Step Function with context that includes `customerDomain`, `subjectType`, and the generated `vectorStoreId`.
6. **Vector store batch polling** (`VectorStoreBatchFlow` defined in `sst.config.ts`): polls ingestion status, then sends a `MarketAnalysisQueue` message containing `customerDomain`, `subjectType`, `industries`, `markets`, `legalName`, `domain`, and `vectorStoreId`.
7. **Market analysis subscriber** (`src/handler/marketanalysis/subscribe.downstream.js`): fetches or generates market analysis using news signals from the provided `vectorStoreId` via the OpenAI `file_search` tool, stores it, and links it back to the master data record.
8. **Collection bootstrap** (`src/handler/createcollection.js`, `WeaviateCollectionCreator`): recreates Weaviate collections from the schemas in `src/model.js` using `mapZodToWeaviateProperties`.

### Payload notes
- Every queued payload that includes a `domain` must also include the original `customerDomain` and `subjectType` (`customer` | `competitor`).
- `vectorStoreId` is required for market analysis so the OpenAI `file_search` tool can surface recent news signals.
- Competitors reuse the same queues as customers; only customers trigger the competition search.

## Additional references
- Model schemas and registry: `src/model.js`
- OpenAI prompt rendering: `src/util/openai.js`
- Request validation helper: `src/util/request.js`
- Vector store batching spec: `spec/VECTORSTORE_BATCH_SPEC.md`
