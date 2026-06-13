// tests/unit/loop.test.ts
import { describe, it, expect, vi } from "vitest";

// fireAlarm writes to Supabase; mocking it keeps this a pure unit test and
// avoids the db/client module throwing on missing SUPABASE_* env at import.
vi.mock("../../src/alarms/index", () => ({
  fireAlarm: vi.fn(async () => {}),
}));

import { runLoop } from "../../src/loop/index";
import { MockWorker } from "../../src/worker/mock";

describe("runLoop", () => {
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
