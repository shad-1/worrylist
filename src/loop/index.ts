import type { Worker, Message, ToolSchema, WorkerReply } from "../worker/interface";
import type { TriggerType } from "../db/runs";
import { validateInput } from "../guardrails/input";
import { validateOutput } from "../guardrails/output";
import { applyActionGuardrail } from "../guardrails/action";
import { fireAlarm } from "../alarms/index";
import { withToolSpan } from "../observability/index";
import { GUARDRAILS } from "../config/guardrails";

export interface LoopResult {
  text: string;
  turns: number;
  tokensIn: number;
  tokensOut: number;
}

export interface LoopOptions {
  worker: Worker;
  systemPrompt: string;
  userInput: string;
  tools: ToolSchema[];
  runId: string;
  triggerType: TriggerType;
  dispatch: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  maxTurns?: number;
  maxTokens?: number;
  startedAt?: Date;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    worker, systemPrompt, userInput, tools, runId, triggerType,
    dispatch, maxTurns = GUARDRAILS.loop.max_turns,
    maxTokens = GUARDRAILS.loop.max_tokens_total,
    startedAt = new Date(),
  } = opts;

  // Input guardrail
  const inputCheck = validateInput(userInput);
  if (!inputCheck.passed) {
    await fireAlarm("GUARDRAIL_VIOLATION", runId, { reason: inputCheck.reason, layer: "input" });
    throw new Error(`Input guardrail failed: ${inputCheck.reason}`);
  }

  const messages: Message[] = [
    { role: "user", content: `${systemPrompt}\n\n${inputCheck.sanitized ?? userInput}` },
  ];

  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    // Wall-time guardrail
    if (Date.now() - startedAt.getTime() > GUARDRAILS.loop.max_wall_time_ms) {
      await fireAlarm("TURN_LIMIT_REACHED", runId, { reason: "wall time exceeded", turn });
      throw new Error("Wall time limit exceeded");
    }

    const reply: WorkerReply = await worker.chat(messages, tools, {
      maxTokens: Math.min(4096, maxTokens - totalTokensIn - totalTokensOut),
      temperature: 0.2,
    }, { runId, triggerType, turn });

    totalTokensIn += reply.usage.inputTokens;
    totalTokensOut += reply.usage.outputTokens;

    // Token guardrail
    if (totalTokensIn + totalTokensOut > maxTokens) {
      await fireAlarm("TOKEN_BUDGET_EXCEEDED", runId, { total: totalTokensIn + totalTokensOut });
      throw new Error("Token budget exceeded");
    }

    messages.push({ role: "assistant", content: reply.text ?? "", toolCalls: reply.toolCalls });

    // No tool calls — final answer
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      const text = reply.text ?? "";
      const outputCheck = validateOutput(text);
      if (!outputCheck.passed) {
        await fireAlarm("GUARDRAIL_VIOLATION", runId, { reason: outputCheck.reason, layer: "output" });
        throw new Error(`Output guardrail failed: ${outputCheck.reason}`);
      }
      return { text, turns: turn, tokensIn: totalTokensIn, tokensOut: totalTokensOut };
    }

    // Dispatch tool calls
    for (const toolCall of reply.toolCalls) {
      const guardrailResult = applyActionGuardrail(toolCall.name, toolCall.args);

      let toolResult: unknown;

      if (guardrailResult.policy === "blocked") {
        await fireAlarm("GUARDRAIL_VIOLATION", runId, {
          tool: toolCall.name, reason: guardrailResult.reason, layer: "action",
        });
        toolResult = { error: "BLOCKED", reason: guardrailResult.reason };
      } else if (guardrailResult.policy === "requires_approval") {
        // Write approval_request alert and let loop continue
        toolResult = await withToolSpan("write_alert", { type: "approval_request" }, () =>
          dispatch("write_alert", {
            type: "approval_request",
            title: `Approval required: ${toolCall.name}`,
            payload: { toolName: toolCall.name, args: toolCall.args, reason: guardrailResult.reason },
          })
        );
      } else {
        toolResult = await withToolSpan(toolCall.name, toolCall.args, () =>
          dispatch(toolCall.name, toolCall.args)
        );
      }

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
    }
  }

  await fireAlarm("TURN_LIMIT_REACHED", runId, { maxTurns });
  throw new Error(`Turn limit reached after ${maxTurns} turns`);
}
