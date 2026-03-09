import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

// ── Provider configuration ──

export type Provider = "anthropic" | "openai";

interface ProviderConfig {
  provider: Provider;
  defaultModel: string;
  reasoningModel: string;
}

const MODEL_DEFAULTS: Record<Provider, { default: string; reasoning: string }> =
  {
    anthropic: {
      default: "claude-sonnet-4-6",
      reasoning: "claude-opus-4-6",
    },
    openai: {
      default: "gpt-4.1-mini",
      reasoning: "gpt-4.1",
    },
  };

let _config: ProviderConfig | null = null;

export function configureProvider(
  provider: Provider,
  defaultModel?: string,
  reasoningModel?: string,
) {
  const defaults = MODEL_DEFAULTS[provider];
  _config = {
    provider,
    defaultModel: defaultModel ?? defaults.default,
    reasoningModel: reasoningModel ?? defaults.reasoning,
  };
}

function getConfig(): ProviderConfig {
  if (!_config) {
    throw new Error("Provider not configured. Call configureProvider() first.");
  }
  return _config;
}

export function getDefaultModel(): string {
  return getConfig().defaultModel;
}

export function getReasoningModel(): string {
  return getConfig().reasoningModel;
}

// ── Retry logic ──

const MAX_RETRIES = 5;

async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status =
        error instanceof Error && "status" in error
          ? (error as { status: number }).status
          : 0;
      const isRateLimit = status === 429;

      if (!isRateLimit || attempt === MAX_RETRIES - 1) {
        throw error;
      }

      let waitSeconds = Math.min(30 * Math.pow(2, attempt), 360);

      // Try to read retry-after header from either SDK's error type
      if (error instanceof Anthropic.APIError && error.headers) {
        const retryAfter = error.headers.get("retry-after");
        if (retryAfter) {
          waitSeconds = Math.min(
            parseInt(retryAfter, 10) || waitSeconds,
            600,
          );
        }
      } else if (error instanceof OpenAI.APIError && error.headers) {
        const retryAfter = error.headers["retry-after"];
        if (retryAfter) {
          waitSeconds = Math.min(
            parseInt(String(retryAfter), 10) || waitSeconds,
            600,
          );
        }
      }

      console.log(
        `  [retry] Rate limited (${context}). Waiting ${waitSeconds}s before attempt ${attempt + 2}/${MAX_RETRIES}...`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  throw new Error("Unreachable");
}

// ── Common interface ──

export interface CallAgentParams<T> {
  reasoning?: boolean;
  systemPrompt: string;
  userPrompt: string;
  outputSchema: z.ZodType<T>;
  outputToolName: string;
  outputToolDescription: string;
  useWebSearch?: boolean;
  maxSearches?: number;
  maxTokens?: number;
}

export async function callAgent<T>(params: CallAgentParams<T>): Promise<T> {
  const config = getConfig();
  if (config.provider === "openai") {
    return callOpenAIAgent(params);
  }
  return callAnthropicAgent(params);
}

// ── Anthropic implementation ──

let _anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required.");
    }
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
}

async function callAnthropicAgent<T>(
  params: CallAgentParams<T>,
): Promise<T> {
  const client = getAnthropicClient();
  const config = getConfig();
  const {
    reasoning = false,
    systemPrompt,
    userPrompt,
    outputSchema,
    outputToolName,
    outputToolDescription,
    useWebSearch = false,
    maxSearches = 10,
    maxTokens = 16000,
  } = params;

  const model = reasoning ? config.reasoningModel : config.defaultModel;

  const jsonSchema = zodToJsonSchema(outputSchema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  const cleanSchema = { ...jsonSchema } as Record<string, unknown>;
  delete cleanSchema["$schema"];

  const tools: Anthropic.Messages.Tool[] = [];

  if (useWebSearch) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxSearches,
    } as unknown as Anthropic.Messages.Tool);
  }

  tools.push({
    name: outputToolName,
    description: outputToolDescription,
    input_schema: cleanSchema as Anthropic.Messages.Tool.InputSchema,
  });

  let messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  const MAX_ITERATIONS = 20;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await withRetry(
      () =>
        client.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages,
          tools,
        }),
      outputToolName,
    );

    const outputBlock = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock =>
        b.type === "tool_use" && b.name === outputToolName,
    );

    if (outputBlock) {
      return outputSchema.parse(outputBlock.input);
    }

    if (response.stop_reason === "end_turn") {
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: `Now save your findings using the ${outputToolName} tool. You must call the ${outputToolName} tool with your structured results.`,
        },
      ];
      continue;
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      const ourTool = toolUseBlocks.find((b) => b.name === outputToolName);
      if (ourTool) {
        return outputSchema.parse(ourTool.input);
      }

      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: `Continue your research and when done, save results using the ${outputToolName} tool.`,
        },
      ];
      continue;
    }

    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: `Please continue and save your results using the ${outputToolName} tool.`,
      },
    ];
  }

  throw new Error(
    `Anthropic agent did not produce output after ${MAX_ITERATIONS} iterations`,
  );
}

// ── OpenAI implementation ──

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required.");
    }
    _openaiClient = new OpenAI({ apiKey });
  }
  return _openaiClient;
}

/**
 * Recursively set additionalProperties: false on all object schemas.
 * OpenAI strict mode requires this at every nesting level.
 */
function enforceAdditionalProperties(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };

  if (result.type === "object") {
    result.additionalProperties = false;

    // Process nested properties
    if (result.properties && typeof result.properties === "object") {
      const props = { ...(result.properties as Record<string, unknown>) };
      for (const key of Object.keys(props)) {
        if (props[key] && typeof props[key] === "object") {
          props[key] = enforceAdditionalProperties(
            props[key] as Record<string, unknown>,
          );
        }
      }
      result.properties = props;
    }
  }

  // Process array items
  if (result.type === "array" && result.items && typeof result.items === "object") {
    result.items = enforceAdditionalProperties(
      result.items as Record<string, unknown>,
    );
  }

  // Process anyOf/oneOf/allOf
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map((s) =>
        enforceAdditionalProperties(s),
      );
    }
  }

  return result;
}

async function callOpenAIAgent<T>(params: CallAgentParams<T>): Promise<T> {
  const client = getOpenAIClient();
  const config = getConfig();
  const {
    reasoning = false,
    systemPrompt,
    userPrompt,
    outputSchema,
    outputToolName,
    useWebSearch = false,
    maxTokens = 16000,
  } = params;

  const model = reasoning ? config.reasoningModel : config.defaultModel;

  const jsonSchema = zodToJsonSchema(outputSchema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  const cleanSchema = enforceAdditionalProperties(jsonSchema as Record<string, unknown>);
  delete cleanSchema["$schema"];

  const tools: OpenAI.Responses.Tool[] = [];

  if (useWebSearch) {
    tools.push({ type: "web_search_preview" });
  }

  const response = await withRetry(
    () =>
      client.responses.create({
        model,
        instructions: systemPrompt,
        input: userPrompt,
        tools,
        text: {
          format: {
            type: "json_schema",
            name: outputToolName,
            schema: cleanSchema,
            strict: true,
          },
        },
      }),
    outputToolName,
  );

  // Extract the text output from the response
  const textOutput = response.output.find(
    (item): item is OpenAI.Responses.ResponseOutputMessage =>
      item.type === "message",
  );

  if (!textOutput) {
    throw new Error("OpenAI response did not contain a message output");
  }

  const textContent = textOutput.content.find(
    (c): c is OpenAI.Responses.ResponseOutputText => c.type === "output_text",
  );

  if (!textContent) {
    throw new Error("OpenAI response did not contain text content");
  }

  const parsed = JSON.parse(textContent.text);
  return outputSchema.parse(parsed);
}
