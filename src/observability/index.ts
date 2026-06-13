import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import OpenAI from "openai";
import { observeOpenAI } from "@langfuse/openai";

// Call once at process start, before any other imports that use OpenAI
export function initTracing(): NodeSDK {
  const sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
  return sdk;
}

const tracer = trace.getTracer("worrylist");

export interface TraceCtx {
  runId: string;
  triggerType: "classify" | "digest" | "recovery" | "manual";
  turn: number;
}

// Wraps a stage (extracting, deduplicating, writing, validating) in a span.
// LLM calls and tool spans nested inside are automatically parented to it.
export async function withStageSpan<T>(
  stage: string,
  runId: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`stage:${stage}`, async (span) => {
    span.setAttribute("run.id", runId);
    span.setAttribute("stage", stage);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Wraps a tool dispatch in a span. Call this inside the loop's tool dispatcher.
export async function withToolSpan<T>(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`tool:${toolName}`, async (span) => {
    span.setAttribute("tool.name", toolName);
    // Avoid logging args that may contain user content verbatim — log keys only
    span.setAttribute("tool.arg_keys", Object.keys(args).join(","));
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Returns an instrumented OpenAI client pointed at OpenRouter.
// Call once per worker.chat() invocation so generationName includes the turn number.
// The client is NOT reused across turns — observeOpenAI captures metadata at wrap time.
export function createTracedClient(
  apiKey: string,
  ctx: TraceCtx
): ReturnType<typeof observeOpenAI> {
  const base = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  return observeOpenAI(base, {
    generationName: `${ctx.triggerType}-turn-${ctx.turn}`,
    sessionId: ctx.runId,
    tags: [ctx.triggerType],
    generationMetadata: { turn: ctx.turn },
  });
}

// Call at the end of each request handler to flush buffered spans to Langfuse.
// Do NOT call sdk.shutdown() — that stops the OTel SDK for the process lifetime.
export async function flushTraces(processor: LangfuseSpanProcessor): Promise<void> {
  await processor.forceFlush();
}
