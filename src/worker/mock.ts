import type { Worker, Message, ToolSchema, WorkerConfig, WorkerReply, TraceCtx, ToolCall } from "./interface";

interface MockConfig {
  text?: string;
  toolCall?: ToolCall;
}

export class MockWorker implements Worker {
  readonly model = "mock";

  constructor(private config: MockConfig) {}

  async chat(
    _messages: Message[],
    _tools: ToolSchema[],
    _config: WorkerConfig,
    _traceCtx: TraceCtx
  ): Promise<WorkerReply> {
    return {
      text: this.config.toolCall ? undefined : (this.config.text ?? ""),
      toolCalls: this.config.toolCall ? [this.config.toolCall] : undefined,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: this.model,
    };
  }
}
