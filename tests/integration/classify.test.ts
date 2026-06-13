import { describe, it, expect, vi } from "vitest";

// Self-contained: mock the Supabase client and the OpenRouter worker so the
// classify handler runs end-to-end without network/DB.
//
// The handler exercises chained query builders (e.g. .select().eq().eq()) and
// also awaits builders directly (countAttempts), so the mock builder is both
// fully chainable AND thenable. Terminal .single()/.maybeSingle() resolve to a
// record (used by insertRun); a direct await resolves to a list/count result
// (used by countAttempts and the approval-alert count query).
vi.mock("../../src/db/client", () => {
  const listResult = { data: [] as unknown[], count: 0, error: null };
  const singleResult = { data: { id: "mock-run-id", notion_page_id: null }, error: null };

  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "lt", "gt", "gte", "lte", "order", "limit", "textSearch"]) {
      chain[m] = () => chain;
    }
    chain.single = () => Promise.resolve(singleResult);
    chain.maybeSingle = () => Promise.resolve(singleResult);
    // Thenable: `await db.from(...).select().eq()` resolves to the list result.
    chain.then = (onFulfilled: (v: typeof listResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(listResult).then(onFulfilled, onRejected);
    return chain;
  };

  return { db: { from: () => makeChain() } };
});

vi.mock("../../src/worker/openrouter", () => ({
  OpenRouterWorker: class {
    model = "mock-model";
    chat = vi.fn().mockResolvedValue({
      text: '{"processed":1,"created":1,"updated":0}',
      toolCalls: undefined,
      usage: { inputTokens: 50, outputTokens: 20 },
      model: "mock-model",
    });
  },
}));

import { handleClassify } from "../../src/triggers/classify";

describe("handleClassify", () => {
  it("completes without throwing for valid input", async () => {
    await expect(
      handleClassify({
        thought_id: "thought-123",
        notion_page_id: "notion-page-123",
        content: "I need to finish the AWS cost report by Friday",
        model: "mock-model",
      })
    ).resolves.not.toThrow();
  });
});
