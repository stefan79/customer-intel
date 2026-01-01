/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "customer-intel",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const OpenAIApiKey = new sst.Secret("OpenAIApiKey")

    const WeaviateEndpoint = "https://nzksocuaq92fyttubbseyg.c0.europe-west3.gcp.weaviate.cloud"
    const WeaviateAPIKey = new sst.Secret("WeaviateAPIKey")

    const maxReceiveCount = 1
    const VECTORSTORE_POLL_INTERVAL_SECONDS = 10
    const VECTORSTORE_POLL_MAX_ATTEMPTS = 30

    const AssessmentQueueDLQ = new sst.aws.Queue("AssessmentQueueDLQ", {})
    const CompetitionQueueDLQ = new sst.aws.Queue("CompetitionQueueDLQ", {})
    const MarketAnalysisQueueDLQ = new sst.aws.Queue("MarketAnalysisQueueDLQ", {})
    const NewsQueueDLQ = new sst.aws.Queue("NewsQueueDLQ", {})
    const DownloadQueueDLQ = new sst.aws.Queue("DownloadQueueDLQ", {})

    const AssessmentQueue = new sst.aws.Queue("AssessmentQueue", {
      dlq: {
        queue: AssessmentQueueDLQ.arn,
        retry: maxReceiveCount,
      },
    });

    const CompetitionQueue = new sst.aws.Queue("CompetitionQueue", {
      dlq: {
        queue: CompetitionQueueDLQ.arn,
        retry: maxReceiveCount,
      },
    });

    const MarketAnalysisQueue = new sst.aws.Queue("MarketAnalysisQueue", {
      dlq: {
        queue: MarketAnalysisQueueDLQ.arn,
        retry: maxReceiveCount,
      },
    });

    const NewsQueue = new sst.aws.Queue("NewsQueue", {
      dlq: {
        queue: NewsQueueDLQ.arn,
        retry: maxReceiveCount,
      },
    });

    const DownloadQueue = new sst.aws.Queue("DownloadQueue", {
      dlq: {
        queue: DownloadQueueDLQ.arn,
        retry: maxReceiveCount,
      },
    });

    const VectorStoreCheckBatch = new sst.aws.Function("VectorStoreCheckBatch", {
      handler: "src/handler/loadintovectorstore/check.batch.handler",
      link: [OpenAIApiKey],
    });

    const notifyMarketAnalysis = sst.aws.StepFunctions.sqsSendMessage({
      name: "NotifyMarketAnalysis",
      queue: MarketAnalysisQueue,
      messageBody:
        "{% $string({\"legalName\": $states.input.context.legalName, \"domain\": $states.input.context.domain, \"customerDomain\": $states.input.context.customerDomain, \"subjectType\": $states.input.context.subjectType, \"industries\": $states.input.context.industries, \"markets\": $states.input.context.markets, \"vectorStoreId\": $states.input.vectorStoreId}) %}",
    });

    const checkBatchStatus = sst.aws.StepFunctions.lambdaInvoke({
      name: "CheckBatchStatus",
      function: VectorStoreCheckBatch,
      payload: "{% $states.input %}",
      output: "{% $states.result.Payload %}",
    })
      .retry({
        errors: ["BatchPending"],
        interval: `${VECTORSTORE_POLL_INTERVAL_SECONDS} seconds`,
        maxAttempts: VECTORSTORE_POLL_MAX_ATTEMPTS,
        backoffRate: 1,
      });

    const batchFailed = sst.aws.StepFunctions.fail({ name: "BatchFailed" });
    const pollTimeout = sst.aws.StepFunctions.fail({ name: "PollTimeout" });
    const done = sst.aws.StepFunctions.succeed({ name: "Done" });

    notifyMarketAnalysis.next(done);

    checkBatchStatus
      .catch(batchFailed, { errors: ["BatchFailed"] })
      .catch(pollTimeout, { errors: ["BatchPending"] })
      .catch(batchFailed, { errors: ["States.ALL"] })
      .next(notifyMarketAnalysis);

    const VectorStoreBatchFlow = new sst.aws.StepFunctions(
      "VectorStoreBatchFlow",
      {
        definition: checkBatchStatus,
      }
    );


    AssessmentQueue.subscribe({
      handler: "src/handler/assessment/subscribe.downstream.handler", 
      link: [OpenAIApiKey, WeaviateAPIKey, CompetitionQueue, MarketAnalysisQueue, NewsQueue],
      environment: {
        WeaviateEndpoint
      }
    })

    CompetitionQueue.subscribe({
      handler: "src/handler/competition/subscribe.downstream.handler",
      link: [OpenAIApiKey, WeaviateAPIKey],
      environment: {
        WeaviateEndpoint
      }
    })

    MarketAnalysisQueue.subscribe({
      handler: "src/handler/marketanalysis/subscribe.downstream.handler",
      link: [OpenAIApiKey, WeaviateAPIKey],
      environment: {
        WeaviateEndpoint
      }
    })

    NewsQueue.subscribe({
      handler: "src/handler/news/subscribe.fanout.handler",
      link: [OpenAIApiKey, WeaviateAPIKey, DownloadQueue],
      environment: {
        WeaviateEndpoint
      }
    })

    DownloadQueue.subscribe({
      handler: "src/handler/loadintovectorstore/subscribe.poll.handler",
      link: [OpenAIApiKey, WeaviateAPIKey, VectorStoreBatchFlow],
      environment: {
        WeaviateEndpoint
      }
    })

    new sst.aws.Function("MasterDataCallDownStreamHandler", {
      handler: "src/handler/masterdata/call.downstream.handler", 
      link: [OpenAIApiKey, WeaviateAPIKey, AssessmentQueue],
      environment: {
        WeaviateEndpoint
      }
    });

    new sst.aws.Function("WeaviateCollectionCreator", {
      handler: "src/handler/createcollection.handler", 
      link: [WeaviateAPIKey],
      environment: {
        WeaviateEndpoint
      }
    })
  },
});
