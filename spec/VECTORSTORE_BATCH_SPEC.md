# Vector Store Batch Upload + Polling Spec

Goal
- Keep per-record OpenAI file upload as-is in `src/handler/loadintovectorstore/subscribe.poll.js`.
- After processing all records in one invocation, create vector store file batches (per vector store).
- Use a Step Functions polling workflow to detect batch completion.
- Buffer request parameters (ex: domain) in the Step Functions execution so completion can fan out to market research.
- If a URL download fails, generate a more detailed markdown summary and upload it as the file.

Current Behavior (baseline)
- `DownloadQueue` feeds `src/handler/loadintovectorstore/subscribe.poll.js`.
- For each record:
  - Validate payload.
  - Download file URL.
  - Upload file to OpenAI.
  - Add file to a vector store immediately via `vectorStores.files.create`.

Target Behavior (Polling)
1) In `subscribe.poll.js`:
   - For each record:
     - Validate request.
     - Download file.
     - If download fails, generate a more detailed markdown summary from `fallback` and upload it instead.
     - Upload file (downloaded or generated) to OpenAI files.
     - Group file IDs by vector store name.
   - After iterating all records:
     - Resolve vector store IDs per group.
     - Create a file batch per vector store with `vectorStores.fileBatches.create`.
     - Start a Step Functions execution per batch, passing:
       - `vectorStoreId`, `vectorStoreName`, `batchId`
       - Buffered request fields (ex: `domain`, `type`, `legalCompanyName`, etc.).

2) Step Functions state machine (polling pattern):
   - `CheckBatchStatus` (Lambda): calls `vectorStores.fileBatches.retrieve`, increments `pollAttempts`, and returns status.
   - `Choice`:
     - If `status === "completed"` -> `NotifyMarketAnalysis`.
     - If `status in ["failed", "cancelled"]` -> fail.
     - Else -> `Wait` -> loop back to `CheckBatchStatus`.

SST Infrastructure Changes (sst.config.ts)
- Reuse existing `MarketAnalysisQueue` and its DLQ (no new queue).
- Add polling configuration variables in `sst.config.ts` (deployment-time constants):
  - `VECTORSTORE_POLL_INTERVAL_SECONDS`
  - `VECTORSTORE_POLL_MAX_ATTEMPTS`
- New Step Functions state machine:
  - `VectorStoreBatchFlow` (polling pattern).
- New Lambda handlers:
  - `src/handler/loadintovectorstore/check.batch.handler`
- Wiring:
  - `DownloadQueue.subscribe` links to:
    - `OpenAIApiKey` (existing)
    - `VectorStoreBatchFlow` (new)
  - `CheckBatchStatus` links to `OpenAIApiKey`.

Step Functions Definition (SST v3)
- `CheckBatchStatus` -> `Choice`:
  - completed -> `NotifyMarketAnalysis` (SQS send message task) -> `Succeed`
  - failed/cancelled -> `Fail`
  - otherwise -> `Wait(POLL_INTERVAL_SECONDS)` -> `CheckBatchStatus`
- The Wait state is managed by Step Functions; the Lambda only runs during each short `CheckBatchStatus` invocation.
- Guardrails:
  - Track `pollAttempts` in the state input and fail when `pollAttempts >= POLL_MAX_ATTEMPTS`.
  - `CheckBatchStatus` must return `pollAttempts + 1` so the loop progresses.
  - `POLL_INTERVAL_SECONDS` and `POLL_MAX_ATTEMPTS` are defined in `sst.config.ts` and baked into the state machine definition.
  - Default values: `VECTORSTORE_POLL_INTERVAL_SECONDS = 10`, `VECTORSTORE_POLL_MAX_ATTEMPTS = 10`.

Payloads
- State machine input (example):
  {
    "vectorStoreId": "vs_...",
    "vectorStoreName": "news/example.com",
    "batchId": "vsfb_...",
    "pollAttempts": 0,
    "context": {
      "domain": "example.com",
      "type": "news",
      "legalCompanyName": "Example Inc"
    }
  }

- MarketAnalysisQueue message (example, keep current schema + add vectorStoreId):
  {
    "legalName": "Example Inc",
    "domain": "example.com",
    "industries": ["Industrial Automation"],
    "markets": ["DACH"],
    "vectorStoreId": "vs_..."
  }

Code Changes Summary
- `src/handler/loadintovectorstore/subscribe.poll.js`
  - Buffer file IDs by vector store.
  - Create file batches after processing records.
  - Start Step Functions executions with buffered context.
  - On download failure, generate markdown summary and upload as file.

- `src/handler/loadintovectorstore/check.batch.js`
  - Input: vectorStoreId, batchId, context.
  - Output: status + input passthrough + incremented `pollAttempts`.

- Step Functions `sqsSendMessage` task
  - Enqueue to `MarketAnalysisQueue` with buffered context.
  - Include `vectorStoreId` so downstream analysis can fetch from that store.

- `src/handler/marketanalysis/subscribe.downstream.js`
  - Update to accept optional `vectorStoreId` for research calls.
  - Update the request schema in `src/cmd/generateMarketAnalysis.js` to allow `vectorStoreId`.

- `src/cmd/generateMarkdownFallback.js` (new)
  - Command module to generate detailed markdown when URL download fails.
  - Uses `fallback`, `domain`, and `type` to produce a richer markdown summary.
  - Keep model and prompt in this module; output must be markdown only.

OpenAI API Notes
- `vectorStores.fileBatches.create(vsId, { file_ids })` creates the batch.
- `vectorStores.fileBatches.retrieve(vsId, batchId)` retrieves batch status for polling.
- For fallback markdown files, create a readable stream or buffer from the markdown string and pass it to `oc.files.create`.

Resolved Decisions
- Reuse `MarketAnalysisQueue`.
- Include `vectorStoreId` in the message payload to support research calls.
- If a URL download fails, generate a more detailed markdown summary and upload it as the file.
- Polling interval and max wait time are configured via SST config variables.
- Use Step Functions to send `NotifyMarketAnalysis` via SQS (no Lambda).

Verification
- Run `npm run lint`.
