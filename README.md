# Customer Intel

Customer Intel processes company data through SST-managed queues and Lambdas to enrich Weaviate collections, run OpenAI generations, and populate vector stores for downstream research.

## Prerequisites
- Node.js 18+ and `pnpm` installed.
- AWS credentials configured for your target stage.
- Secrets set via SST for each stage:
  - `OpenAIApiKey`
  - `WeaviateAPIKey`
  - `VendorCatalogVectorStoreId` (vector store id for the private vendor/service catalog used in service matching)
- The Weaviate endpoint is defined in `sst.config.ts` and passed to functions through `environment`.

## Installation
```bash
pnpm install
```

## Secrets and environment
Set secrets per stage before running `sst dev` or deploying:
```bash
pnpx sst secrets set --stage <stage> OpenAIApiKey <value>
pnpx sst secrets set --stage <stage> WeaviateAPIKey <value>
```

## Local development
- Lint the code and EJS templates:
  ```bash
  pnpm lint
  pnpm lint:ejs
  ```
- Start the SST dev environment (using `pnpx` via `pnpm dlx`):
  ```bash
pnpx sst dev --stage <stage>
```
- Deploy to a stage:
```bash
pnpx sst deploy --stage <stage>
```

### Vendor catalog setup
- Upload the vendor/service catalog to OpenAI files and create a vector store from it.
- Store the resulting vector store id in the `VendorCatalogVectorStoreId` secret per stage:
  ```bash
  pnpx sst secrets set --stage <stage> VendorCatalogVectorStoreId <vector-store-id>
  ```

## Manual Lambda invocations
Use AWS CLI discovery to avoid hardcoding Lambda names. Replace `<stage>` and `example.com` as needed.

- Create (or recreate) Weaviate collections:
  ```bash
  COLLECTION_FN=$(aws lambda list-functions \
    --query "Functions[?contains(FunctionName, 'WeaviateCollectionCreatorFunction')].FunctionName | [0]" \
    --output text)
  aws lambda invoke --function-name "$COLLECTION_FN" collection.json
  ```
- Trigger master data entrypoint:
  ```bash
  MASTERDATA_FN=$(aws lambda list-functions \
    --query "Functions[?contains(FunctionName, 'MasterDataCallDownStreamHandlerFunction')].FunctionName | [0]" \
    --output text)
  aws lambda invoke --function-name "$MASTERDATA_FN" \
    --payload '{"legalName":"Example Co","domain":"example.com"}' \
    --cli-binary-format raw-in-base64-out output.json
  ```
- Trigger IT strategy generation (Phase 1) by enqueueing the IT strategy queue:
  ```bash
  aws sqs send-message \
    --queue-url "$(aws sqs get-queue-url --queue-name customer-intel-ITStrategyQueue --output text --query QueueUrl)" \
    --message-body '{"customerDomain":"example.com","subjectType":"customer"}'
  ```
- Trigger service matching manually (requires an existing IT strategy id):
  ```bash
  aws sqs send-message \
    --queue-url "$(aws sqs get-queue-url --queue-name customer-intel-ServiceMatchingQueue --output text --query QueueUrl)" \
    --message-body '{"customerDomain":"example.com","subjectType":"customer","customerLegalName":"Example Co","itStrategyId":"example.com","vendorCatalogVectorStoreId":"vs_123"}'
  ```
- Trigger sales meeting prep manually (requires an existing service matching id):
  ```bash
  aws sqs send-message \
    --queue-url "$(aws sqs get-queue-url --queue-name customer-intel-SalesMeetingPrepQueue --output text --query QueueUrl)" \
    --message-body '{"customerDomain":"example.com","subjectType":"customer","customerLegalName":"Example Co","itStrategyId":"example.com","serviceMatchingId":"example.com"}'
  ```

## Processing flow
1. **Master data entrypoint** (`src/handler/masterdata/call.downstream.js`, `MasterDataCallDownStreamHandler`): validates the request (including `customerDomain` + `subjectType`, defaulting to a `customer`), generates company master data via OpenAI when missing, stores it in Weaviate, and enqueues the enriched request on `AssessmentQueue`.
2. **Assessment subscriber** (`src/handler/assessment/subscribe.downstream.js`): fetches or generates an assessment, links it to master data, and fans out:
   - **CompetitionQueue** payload (customers only) extends the request with `revenueInMio`, `industries`, and `markets` from the assessment.
   - **NewsQueue** payload carries `customerDomain`, `domain`, `legalCompanyName`, and `subjectType` for news discovery.
3. **Competition subscriber** (`src/handler/competition/subscribe.downstream.js`): fetches or generates competing companies, ensures competitor master data exists, links the customer to competitors via `competingCompanies`, and enqueues competitor assessments (`subjectType=competitor`) on `AssessmentQueue` without triggering further competition searches.
4. **News fanout subscriber** (`src/handler/news/subscribe.fanout.js`): generates company news items (annotated with `customerDomain` and `subjectType`), stores new entries, and sends downloadable sources to `DownloadQueue` with `{ customerDomain, domain, subjectType, url, fallback, vectorStore: "news/<domain>", type: "news" }`.
5. **Vector store loader** (`src/handler/loadintovectorstore/subscribe.poll.js`): downloads each URL (or builds markdown fallbacks), uploads files to OpenAI, ensures the target vector store exists, then uses `vectorStores.fileBatches.createAndPoll` to wait for ingestion before enqueueing `MarketAnalysisQueue` with `customerDomain`, `subjectType`, `industries`, `markets`, `legalName`, `domain`, and `vectorStoreId`.
6. **Market analysis subscriber** (`src/handler/marketanalysis/subscribe.downstream.js`): fetches or generates market analysis using news signals from the provided `vectorStoreId` via the OpenAI `file_search` tool, stores it, and links it back to the master data record.
7. **Competition analysis subscriber** (`src/handler/competitionanalysis/subscribe.downstream.js`): combines market analysis context for customer and competitor, generates a comparative analysis, stores it, links it to both master data records, and enqueues IT strategy generation.
8. **IT strategy subscriber** (`src/handler/itstrategy/subscribe.downstream.js`, `ITStrategyQueue`): loads master data, market analysis, competition analyses, and evidence from Weaviate, generates an IT strategy document (no vendors), stores it, links it to the master record, and enqueues service matching.
9. **Service matching subscriber** (`src/handler/servicematching/subscribe.downstream.js`, `ServiceMatchingQueue`): fetches the IT strategy and master data, queries the vendor catalog vector store via `file_search`, generates service matches, stores them, links to master data, and enqueues sales meeting preparation.
10. **Sales meeting prep subscriber** (`src/handler/salesmeetingprep/subscribe.downstream.js`, `SalesMeetingPrepQueue`): compiles the executive briefing, hypotheses, questions, impulses, and POC ideas using master data, IT strategy, and service matching outputs; stores the result and links it to the master record.
11. **Collection bootstrap** (`src/handler/createcollection.js`, `WeaviateCollectionCreator`): recreates Weaviate collections from the schemas in `src/model.js` using `mapZodToWeaviateProperties`.

### Payload notes
- Every queued payload that includes a `domain` must also include the original `customerDomain` and `subjectType` (`customer` | `competitor`).
- `vectorStoreId` is required for market analysis so the OpenAI `file_search` tool can surface recent news signals.
- Competitors reuse the same queues as customers; only customers trigger the competition search.
- IT strategy, service matching, and sales meeting prep queues must include `customerDomain` and `subjectType` and are keyed by the customer domain as their document id.

## Additional references
- Model schemas and registry: `src/model.js`
- OpenAI prompt rendering: `src/util/openai.js`
- Request validation helper: `src/util/request.js`
- Vector store batching spec: `spec/VECTORSTORE_BATCH_SPEC.md`

## Data model evolution
The collections below are stored in Weaviate and derived in order as the pipeline runs. This diagram shows how each structure is created and linked.

```mermaid
flowchart TD
  Master[CompanyMasterData] --> Assessment[CompanyAssessment]
  Master --> News[CompanyNews]
  Assessment --> Competitors[CompetingCompanies]

  News --> VectorStore[OpenAI Vector Store]
  VectorStore --> MarketAnalysis[MarketAnalysis]
  MarketAnalysis --> CompetitionAnalysis[CompetitionAnalysis]
  Competitors --> CompetitionAnalysis
  Master --> CompetitionAnalysis
  Master --> ITStrategy[ITStrategy]
  ITStrategy --> ServiceMatching[ServiceMatching]
  ServiceMatching --> SalesPrep[SalesMeetingPrep]
  Master --> ServiceMatching
  Master --> SalesPrep
```

### Notes on evolution
- `CompanyMasterData` is the root record keyed by `domain`; it is required before downstream generations can run.
- `CompanyAssessment` enriches the master record with estimates (revenue, markets, industries) and drives competition/news fanout.
- `CompanyNews` collects source URLs and summaries; its content is uploaded to OpenAI vector stores.
- `MarketAnalysis` is generated from the vector store and linked back to the master record.
- `CompetitionAnalysis` ties customer and competitor master data together using market analysis context.
- `ITStrategy` captures business-driven strategies based on market and competition evidence.
- `ServiceMatching` maps approved strategies to existing services in the vendor catalog vector store.
- `SalesMeetingPrep` prepares the executive meeting briefing using approved strategies and service matches.


## Quality Expectation

This is a PoC validating various techniques to create a complex document from a pipeline. Prompts, lenses, and batching/parallelization are intentionally unoptimized, and concepts like retries or larger-scale batching have not been applied. Expect rough edges; prioritize correctness over performance when iterating. 
