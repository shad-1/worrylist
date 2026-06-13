import { describe, it, expect } from "vitest";
import { MockWorker } from "../../src/worker/mock";

describe("MockWorker", () => {
  it("returns configured text reply", async () => {
    const worker = new MockWorker({ text: "hello" });
    const reply = await worker.chat(
      [{ role: "user", content: "hi" }],
      [],
      { maxTokens: 100, temperature: 0 },
      { runId: "test-run", triggerType: "manual", turn: 1 }
    );
    expect(reply.text).toBe("hello");
    expect(reply.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  it("returns tool call when configured", async () => {
    const worker = new MockWorker({
      toolCall: { id: "tc1", name: "search_tasks", args: { query: "AWS" } },
    });
    const reply = await worker.chat([], [], { maxTokens: 100, temperature: 0 }, {
      runId: "r1", triggerType: "manual", turn: 1,
    });
    expect(reply.toolCalls?.[0].name).toBe("search_tasks");
  });
});
