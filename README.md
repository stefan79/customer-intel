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
1. **Master data entrypoint** (`src/handler/masterdata/call.downstream.js`, `MasterDataCallDownStreamHandler`): validates the request, generates company master data via OpenAI when missing, stores it in Weaviate, and enqueues the original request on `AssessmentQueue`.
2. **Assessment subscriber** (`src/handler/assessment/subscribe.downstream.js`): fetches or generates an assessment, links it to master data, and fans out three messages:
   - **CompetitionQueue** payload extends the original request with `revenueInMio`, `industries`, and `markets` from the assessment.
   - **MarketAnalysisQueue** payload keeps `legalName`, `domain`, `industries`, and `markets` for market analysis generation.
   - **NewsQueue** payload keeps `legalCompanyName` and `domain` for news discovery.
3. **Competition subscriber** (`src/handler/competition/subscribe.downstream.js`): fetches or generates competing companies data and stores it in Weaviate.
4. **Market analysis subscriber** (`src/handler/marketanalysis/subscribe.downstream.js`): fetches or generates market analysis, stores it, and links it back to the master data record.
5. **News fanout subscriber** (`src/handler/news/subscribe.fanout.js`): generates company news items, stores any new entries, and sends downloadable sources to `DownloadQueue` when the URL responds successfully. Download messages include `{ domain, url, fallback, vectorStore: "news/<domain>", type: "news" }`.
6. **Vector store loader** (`src/handler/loadintovectorstore/subscribe.poll.js`): downloads each URL, uploads it to OpenAI files, ensures the target vector store exists, and attaches the file to the store. Download payloads also carry `fallback` text for richer handling described in `spec/VECTORSTORE_BATCH_SPEC.md`.
7. **Collection bootstrap** (`src/handler/createcollection.js`, `WeaviateCollectionCreator`): recreates Weaviate collections from the schemas in `src/model.js` using `mapZodToWeaviateProperties`.

## Additional references
- Model schemas and registry: `src/model.js`
- OpenAI prompt rendering: `src/util/openai.js`
- Request validation helper: `src/util/request.js`
- Vector store batching spec: `spec/VECTORSTORE_BATCH_SPEC.md`
