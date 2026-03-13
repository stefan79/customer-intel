import { Command } from "commander";
import { resolve } from "node:path";
import { configureProvider, type Provider } from "./client.js";
import { runPipeline } from "./pipeline.js";

const program = new Command();

program
  .name("customer-intel")
  .description(
    "Customer Intelligence Pipeline - generates comprehensive business intelligence for sales meetings",
  )
  .requiredOption("--domain <domain>", "Company domain (e.g., example.com)")
  .requiredOption("--name <name>", "Company legal name")
  .option(
    "--provider <provider>",
    "AI provider: anthropic or openai",
    "openai",
  )
  .option(
    "--vendor-catalog <path>",
    "Path to vendor services catalog file (markdown/text/JSON)",
  )
  .option("--output <dir>", "Output directory", "./output")
  .action(async (options) => {
    const provider = options.provider as Provider;

    if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
      console.error(
        "Error: ANTHROPIC_API_KEY environment variable is required for Anthropic provider.",
      );
      process.exit(1);
    }
    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
      console.error(
        "Error: OPENAI_API_KEY environment variable is required for OpenAI provider.",
      );
      process.exit(1);
    }

    configureProvider(provider);

    console.log(`Using provider: ${provider}`);

    const config = {
      domain: options.domain as string,
      name: options.name as string,
      vendorCatalogPath: options.vendorCatalog
        ? resolve(options.vendorCatalog as string)
        : undefined,
      outputDir: resolve(options.output as string),
    };

    try {
      await runPipeline(config);
    } catch (error) {
      console.error("\nPipeline failed:", error);
      process.exit(1);
    }
  });

program.parse();
