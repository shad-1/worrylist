import OpenAI from "openai";
import { createTracedClient } from "../observability/index";
import type { Worker, Message, ToolSchema, WorkerConfig, WorkerReply, TraceCtx } from "./interface";

export class OpenRouterWorker implements Worker {
  readonly model: string;

  constructor(model?: string) {
    this.model = model ?? process.env.DEFAULT_WORKER_MODEL ?? "google/gemini-2.0-flash-lite";
  }

  async chat(
    messages: Message[],
    tools: ToolSchema[],
    config: WorkerConfig,
    traceCtx: TraceCtx
  ): Promise<WorkerReply> {
    const client = createTracedClient(process.env.OPENROUTER_API_KEY!, {
      runId: traceCtx.runId,
      triggerType: traceCtx.triggerType,
      turn: traceCtx.turn,
    });

    const oaiMessages = messages.map((m): OpenAI.ChatCompletionMessageParam => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.toolCallId! };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

    const oaiTools: OpenAI.ChatCompletionTool[] | undefined = tools.length > 0
      ? tools.map(t => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;

    const response = await (client as unknown as OpenAI).chat.completions.create({
      model: this.model,
      messages: oaiMessages,
      tools: oaiTools,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    });

    const msg = response.choices[0].message;
    return {
      text: msg.content ?? undefined,
      toolCalls: msg.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }
}
