// tests/unit/loop.test.ts
import { describe, it, expect, vi } from "vitest";

// fireAlarm writes to Supabase; mocking it keeps this a pure unit test and
// avoids the db/client module throwing on missing SUPABASE_* env at import.
vi.mock("../../src/alarms/index", () => ({
  fireAlarm: vi.fn(async () => {}),
}));

import { runLoop } from "../../src/loop/index";
import { MockWorker } from "../../src/worker/mock";
import type { Worker, Message } from "../../src/worker/interface";

describe("runLoop", () => {
  it("sends the assistant's tool_calls back in the message history", async () => {
    // Without this, the model can't see that it already called a tool and loops
    // the same call until the turn limit (observed in production).
    const seen: Message[][] = [];
    let turn = 0;
    const worker: Worker = {
      model: "mock",
      async chat(messages) {
        seen.push(JSON.parse(JSON.stringify(messages)));
        turn += 1;
        if (turn === 1) {
          return {
            toolCalls: [{ id: "tc1", name: "search_tasks", args: { q: "x" } }],
            usage: { inputTokens: 1, outputTokens: 1 },
            model: "mock",
          };
        }
        return { text: "done", usage: { inputTokens: 1, outputTokens: 1 }, model: "mock" };
      },
    };

    const result = await runLoop({
      worker,
      systemPrompt: "s",
      userInput: "u",
      tools: [],
      runId: "r",
      triggerType: "manual",
      dispatch: async () => ({ ok: true }),
    });

    expect(result.text).toBe("done");
    // On turn 2 the history must carry the assistant's tool call, then the result.
    const turn2 = seen[1];
    const assistant = turn2.find((m) => m.role === "assistant" && m.toolCalls);
    expect(assistant?.toolCalls?.[0].name).toBe("search_tasks");
    const toolMsg = turn2.find((m) => m.role === "tool");
    expect(toolMsg?.toolCallId).toBe("tc1");
  });

  it("returns text when worker produces no tool calls", async () => {
    const worker = new MockWorker({ text: "done" });
    const result = await runLoop({
      worker,
      systemPrompt: "You are a helpful assistant.",
      userInput: "hello",
      tools: [],
      runId: "test-run-1",
      triggerType: "manual",
      dispatch: async () => ({ result: "ok" }),
    });
    expect(result.text).toBe("done");
    expect(result.turns).toBe(1);
  });

  it("throws when turn limit reached", async () => {
    // Worker always returns a tool call, so loop spins until limit
    const worker = new MockWorker({
      toolCall: { id: "tc1", name: "search_tasks", args: { query: "test" } },
    });
    await expect(
      runLoop({
        worker,
        systemPrompt: "test",
        userInput: "test",
        tools: [],
        runId: "test-run-2",
        triggerType: "manual",
        dispatch: async () => ({ result: "tool result" }),
        maxTurns: 2,
      })
    ).rejects.toThrow("Turn limit");
  });
});
