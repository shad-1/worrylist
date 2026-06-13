import { describe, it, expect } from "vitest";
import { CHECKPOINTS } from "../../src/config/checkpoints";

describe("ClassificationCheckpoint", () => {
  it("passes for known type with high confidence", () => {
    const result = CHECKPOINTS.ClassificationCheckpoint({ type: "task", confidence: 0.85 });
    expect(result.passed).toBe(true);
  });

  it("fails for unknown type", () => {
    const result = CHECKPOINTS.ClassificationCheckpoint({ type: "unknown", confidence: 0.9 });
    expect(result.passed).toBe(false);
  });

  it("fails when confidence below 0.70", () => {
    const result = CHECKPOINTS.ClassificationCheckpoint({ type: "task", confidence: 0.65 });
    expect(result.passed).toBe(false);
  });
});

describe("PriorityRangeCheckpoint", () => {
  it("passes for valid integers in [1,10]", () => {
    expect(CHECKPOINTS.PriorityRangeCheckpoint({ urgency: 5, importance: 8 }).passed).toBe(true);
  });

  it("fails for out-of-range values", () => {
    expect(CHECKPOINTS.PriorityRangeCheckpoint({ urgency: 0, importance: 5 }).passed).toBe(false);
    expect(CHECKPOINTS.PriorityRangeCheckpoint({ urgency: 5, importance: 11 }).passed).toBe(false);
  });

  it("fails for non-integers", () => {
    expect(CHECKPOINTS.PriorityRangeCheckpoint({ urgency: 5.5, importance: 3 }).passed).toBe(false);
  });
});

describe("AlertSurfacingCheckpoint", () => {
  it("passes when counts match", () => {
    const r = CHECKPOINTS.AlertSurfacingCheckpoint({ expected_approval_count: 2, actual_approval_count: 2 });
    expect(r.passed).toBe(true);
  });

  it("fails when actual is less than expected", () => {
    const r = CHECKPOINTS.AlertSurfacingCheckpoint({ expected_approval_count: 2, actual_approval_count: 1 });
    expect(r.passed).toBe(false);
  });
});

describe("DigestCoverageCheckpoint", () => {
  it("passes when all tasks are covered", () => {
    const r = CHECKPOINTS.DigestCoverageCheckpoint({
      covered_task_ids: ["a", "b"],
      total_pending_task_ids: ["a", "b"],
    });
    expect(r.passed).toBe(true);
  });

  it("fails when a task is missing", () => {
    const r = CHECKPOINTS.DigestCoverageCheckpoint({
      covered_task_ids: ["a"],
      total_pending_task_ids: ["a", "b"],
    });
    expect(r.passed).toBe(false);
  });
});
