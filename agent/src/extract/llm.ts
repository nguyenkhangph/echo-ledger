import { z } from "zod";

import { RateLimiter, type Fetcher, type Sleeper } from "../ingest/http";
import type { IngestedPost } from "../ingest/types";
import { extractionUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "./prompt";
import { ExtractedSignal, type ExtractedSignal as ExtractedSignalType } from "./schema";

const ChatCompletion = z
  .object({
    choices: z.array(
      z.object({
        message: z.object({ content: z.string() }).passthrough(),
      }).passthrough(),
    ).min(1),
  })
  .passthrough();

const sleep: Sleeper = (milliseconds) => Bun.sleep(milliseconds);

export interface LlmClientOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetcher?: Fetcher;
  limiter?: RateLimiter;
  attempts?: number;
  retryDelayMs?: number;
  sleeper?: Sleeper;
}

export interface SignalExtractionClient {
  extract(post: IngestedPost): Promise<ExtractedSignalType>;
}

class NonRetryableLlmError extends Error {}
class UnsupportedResponseFormatError extends Error {}

function requiredSetting(name: "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL", value?: string): string {
  const setting = value ?? process.env[name];
  if (!setting?.trim()) throw new Error(`${name} is required`);
  return setting.trim();
}

function completionUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export function parseExtractedSignal(content: string): ExtractedSignalType {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return ExtractedSignal.parse(JSON.parse(fenced?.[1] ?? trimmed));
}

export class OpenAiCompatibleLlmClient implements SignalExtractionClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetcher: Fetcher;
  private readonly limiter: RateLimiter;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly sleeper: Sleeper;
  private supportsJsonMode = true;

  constructor(options: LlmClientOptions = {}) {
    this.url = completionUrl(requiredSetting("LLM_BASE_URL", options.baseUrl));
    this.apiKey = requiredSetting("LLM_API_KEY", options.apiKey);
    this.model = requiredSetting("LLM_MODEL", options.model);
    this.fetcher = options.fetcher ?? fetch;
    this.limiter = options.limiter ?? new RateLimiter();
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleeper = options.sleeper ?? sleep;
  }

  async extract(post: IngestedPost): Promise<ExtractedSignalType> {
    let parseError: unknown;
    for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt += 1) {
      const messages = [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: extractionUserPrompt(post) },
        ...(parseAttempt === 2
          ? [{ role: "system", content: "Your previous response was invalid. Return only a complete JSON object matching every required field and type." }]
          : []),
      ];
      try {
        return parseExtractedSignal(await this.complete(messages));
      } catch (error) {
        if (error instanceof NonRetryableLlmError) throw error;
        parseError = error;
      }
    }
    throw new Error(`LLM returned an invalid signal for post ${post.id} after one retry`, { cause: parseError });
  }

  private async complete(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      return await this.request(messages, this.supportsJsonMode);
    } catch (error) {
      if (!(error instanceof UnsupportedResponseFormatError)) throw error;
      this.supportsJsonMode = false;
      return this.request(messages, false);
    }
  }

  private async request(messages: Array<{ role: string; content: string }>, jsonMode: boolean): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        await this.limiter.wait();
        const response = await this.fetcher(this.url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: 0,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) {
          const completion = ChatCompletion.parse(await response.json());
          return completion.choices[0]!.message.content;
        }

        const detail = await response.text();
        if (jsonMode && response.status === 400 && /response.?format|json.?mode/i.test(detail)) {
          throw new UnsupportedResponseFormatError("Endpoint does not support JSON response format");
        }
        const error = new Error(`LLM HTTP ${response.status}`);
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          throw new NonRetryableLlmError(error.message);
        }
        lastError = error;
      } catch (error) {
        if (error instanceof NonRetryableLlmError || error instanceof UnsupportedResponseFormatError) throw error;
        lastError = error;
      }

      if (attempt < this.attempts) await this.sleeper(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error("LLM request failed");
  }
}