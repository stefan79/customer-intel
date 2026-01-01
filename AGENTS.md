# AGENTS.md

This project uses SST v3 (ESM JavaScript) with OpenAI + Weaviate. Follow the conventions below so new code stays consistent with the current design and naming patterns.

## Tooling and Docs
- Use Context7 (MCP) for library documentation lookups (SST, OpenAI, Weaviate). Prefer it over web search.
- Keep edits ASCII-only unless the file already contains Unicode.
- Keep style consistent with the file you are editing (indentation, semicolons, line wrapping).
- Use `pnpm` for installs and `pnpx` for one-off commands/scripts (avoid `npm install`).
- For `sst dev`, read `.sst/outputs.json` to access the runtime outputs and infer URLs.
- Keep `README.md` current whenever you change setup steps, workflows, or supported entry points.

## Project Layout
- `sst.config.ts` defines infrastructure (queues, secrets, functions).
- `src/handler/**` contains AWS Lambda handlers.
  - Queue subscribers live in domain folders:
    - `src/handler/assessment/subscribe.downstream.js`
    - `src/handler/competition/subscribe.downstream.js`
    - `src/handler/masterdata/call.downstream.js`
  - Vector store polling helpers:
    - `src/handler/loadintovectorstore/subscribe.poll.js`
    - `src/handler/loadintovectorstore/check.batch.js`
  - Collection bootstrap: `src/handler/createcollection.js`
- `src/cmd/**` contains command modules that call OpenAI and return structured results.
  - Markdown fallback: `src/cmd/generateMarkdownFallback.js`
- `spec/**` contains design specs and implementation drafts.
- `src/model.js` is the source of truth for schemas and collection registry.
- `src/weaviate.js` contains Weaviate client helpers and Zod-to-properties mapping.
- `src/util/request.js` contains the curried request validator.
- `src/util/openai.js` renders prompt templates with EJS.

## SST Conventions
- Use ESM imports/exports everywhere.
- Handlers in `sst.config.ts` are referenced as `"src/.../file.handler"` (no `.js`).
- Use `sst.Secret("Name")` for secrets; access inside handlers via `Resource.Name.value`.
- Non-secret config goes through `environment` and read via `process.env.*`.
- SQS queues use dedicated DLQs and `dlq.retry` from a shared `maxReceiveCount` constant.

## Naming and Structure
- Collections are PascalCase (e.g., `CompanyMasterData`, `CompanyAssessment`, `CompetingCompanies`, `MarketAnalysis`).
- Model registry entries are camelCase (e.g., `companyMasterData`, `companyAssessment`).
- Zod schemas are lowercase `const` with `Schema` only when used outside the model registry.
- Handlers export `export async function handler(...)`.
- Command modules export a default function plus a named `requestValidator`.

## JavaScript Style
- Favor idiomatic, modern JavaScript (prefer `const`/`let`, arrow functions, object shorthand, and concise return paths).
- Reuse helpers or handlers instead of duplicating Lambda logic; keep shared utilities centralized.
- Prefer expressive variable naming over comments that restate the code.

## Handler Roles and Naming
- `call.downstream.js`: a caller/entrypoint handler. It validates input, checks/loads data, and enqueues the next queue.
- `subscribe.downstream.js`: a queue consumer. It validates input, checks/loads data, may generate missing data, and can enqueue the next queue.
- `createcollection.js`: admin/bootstrap handler for (re)creating Weaviate collections.
- Handlers may pass data to downstream queues via SQS when part of the pipeline.

## Handler Responsibilities
- Handlers should only use the model registry for data access (`Model.<entry>.fetchObject`, `insertObject`, `validate`).
- Handlers can enrich a request by loading additional data and merging it with the original request.
- OpenAI calls belong in `src/cmd/*` generators; handlers call these generators rather than embedding prompts.

## Model Registry (src/model.js)
- All domain schemas live in `src/model.js`.
- `generateModelRegistryEntry(zodSchema, collectionName, idName)` returns:
  - `openAIFormat` for OpenAI structured outputs
  - `fetchObject(client, id)`
  - `insertObject(client, properties)`
  - `validate(obj)` using the Zod schema
  - `collectionName` and `zodSchema`
- Always use the registry (`Model.<entry>`) in handlers and commands.

## OpenAI Usage
- Prompt templates are EJS-based; use `generatePrompt(template, { req })`.
- Use `model.openAIFormat` to enforce schema formats when possible.
- If the SDK method does not auto-parse, parse `response.output_text` with the Zod format’s `$parseRaw`.
- Keep model names and prompt text inside `src/cmd/*` modules.

## Weaviate Conventions
- Use `getClient()` from `src/weaviate.js`.
- Use `fetchObject`/`insertObject` via the model registry; they generate `uuid` using `generateUuid5` and the model `idName`.
- When creating collections, use:
  - `name: collectionName`
  - `properties: mapZodToWeaviateProperties(zodSchema)`
- Zod string fields map to Weaviate `text` (no `string`) to avoid nested-property restrictions.

## Validation
- Use `requestValidator` (from `src/util/request.js`) for handler inputs.
- `requestValidator` parses JSON when request bodies are strings and logs invalid payloads before throwing.

## Integration Flow (Current)
- Master data generation -> enqueue assessment -> enqueue competition (customers only).
- Competitor assessment/news/analysis reuse the same pipeline (subjectType=`competitor`) without re-running competition.
- Handlers check Weaviate for existing entries before generating new ones.
- News download -> vector store file batch -> Step Functions polling -> enqueue MarketAnalysis with `vectorStoreId`.
- Queue payloads that include a domain must also include `customerDomain` and `subjectType` (`customer` | `competitor`) and preserve them downstream.

## Gotchas
- `z.coerce.date()` is fine for internal validation, but OpenAI structured outputs return JSON strings; use string dates in model-facing schemas if needed and coerce after parsing.
- Ensure `mapZodToWeaviateProperties` is used for collections to avoid invalid schema payloads.
- Vector store polling interval/attempts are deployment-time constants in `sst.config.ts`.
- Market analysis requests must carry `vectorStoreId` to drive news-signal retrieval downstream.
