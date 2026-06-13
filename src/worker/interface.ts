export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface WorkerReply {
  text?: string;
  toolCalls?: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface WorkerConfig {
  maxTokens: number;
  temperature: number;
}

export interface TraceCtx {
  runId: string;
  triggerType: "classify" | "digest" | "recovery" | "manual";
  turn: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface Worker {
  readonly model: string;
  chat(
    messages: Message[],
    tools: ToolSchema[],
    config: WorkerConfig,
    traceCtx: TraceCtx
  ): Promise<WorkerReply>;
}
