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
      link: [OpenAIApiKey],
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
