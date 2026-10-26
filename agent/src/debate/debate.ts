import type { z } from "zod";

import { parseJsonContent, type ChatMessage, type StructuredCompletionClient } from "../extract/llm";
import { ADVISORY_RISK_CONFIG, type AdvisoryRiskConfig } from "./config";
import {
  bearUserPrompt,
  BEAR_SYSTEM_PROMPT,
  bullUserPrompt,
  BULL_SYSTEM_PROMPT,
  judgeUserPrompt,
  JUDGE_SYSTEM_PROMPT,
  type DebatePromptContext,
} from "./prompts";
import { DebateArgument, DebateResult, JudgeDecision, type DebateResult as DebateResultType } from "./schema";

async function completeStage<T>(
  stage: string,
  client: StructuredCompletionClient,
  schema: z.ZodType<T>,
  messages: readonly ChatMessage[],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryMessage: ChatMessage[] = attempt === 2
      ? [{
          role: "system",
          content: `Your previous ${stage} response was invalid. Return only one complete JSON object matching every required field and type.`,
        }]
      : [];
    try {
      return schema.parse(parseJsonContent(await client.completeJson([...messages, ...retryMessage])));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${stage} stage returned invalid output after one retry`, { cause: lastError });
}

export async function runDebate(
  context: DebatePromptContext,
  client: StructuredCompletionClient,
  riskConfig: AdvisoryRiskConfig = ADVISORY_RISK_CONFIG,
): Promise<DebateResultType> {
  const [bull, bear] = await Promise.all([
    completeStage("Bull", client, DebateArgument, [
      { role: "system", content: BULL_SYSTEM_PROMPT },
      { role: "user", content: bullUserPrompt(context) },
    ]),
    completeStage("Bear", client, DebateArgument, [
      { role: "system", content: BEAR_SYSTEM_PROMPT },
      { role: "user", content: bearUserPrompt(context) },
    ]),
  ]);
  const judge = await completeStage("Judge", client, JudgeDecision, [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: judgeUserPrompt(context, bull, bear, riskConfig) },
  ]);
  return DebateResult.parse({ bull, bear, judge });
}