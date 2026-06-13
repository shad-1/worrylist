export interface CheckpointResult {
  passed: boolean;
  detail: string;
  data?: Record<string, unknown>;
}

export type CheckpointName =
  | "ClassificationCheckpoint"
  | "PriorityRangeCheckpoint"
  | "AlertSurfacingCheckpoint"
  | "DigestCoverageCheckpoint";

export interface ClassificationData {
  type: string;
  confidence: number;
}

export interface PriorityRangeData {
  urgency: number;
  importance: number;
}

export interface AlertSurfacingData {
  expected_approval_count: number;
  actual_approval_count: number;
}

export interface DigestCoverageData {
  covered_task_ids: string[];
  total_pending_task_ids: string[];
}

export const CHECKPOINTS = {
  ClassificationCheckpoint: (data: ClassificationData): CheckpointResult => {
    const knownTypes = ["task", "question", "idea", "concern", "note"];
    const passed = knownTypes.includes(data.type) && data.confidence >= 0.70;
    return {
      passed,
      detail: `type=${data.type} confidence=${data.confidence}`,
      data: data as Record<string, unknown>,
    };
  },

  PriorityRangeCheckpoint: (data: PriorityRangeData): CheckpointResult => {
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 10;
    const passed = valid(data.urgency) && valid(data.importance);
    return {
      passed,
      detail: `urgency=${data.urgency} importance=${data.importance}`,
      data: data as Record<string, unknown>,
    };
  },

  AlertSurfacingCheckpoint: (data: AlertSurfacingData): CheckpointResult => {
    const passed = data.actual_approval_count === data.expected_approval_count;
    return {
      passed,
      detail: `expected=${data.expected_approval_count} actual=${data.actual_approval_count}`,
      data: data as Record<string, unknown>,
    };
  },

  DigestCoverageCheckpoint: (data: DigestCoverageData): CheckpointResult => {
    const covered = new Set(data.covered_task_ids);
    const missing = data.total_pending_task_ids.filter(id => !covered.has(id));
    const passed = missing.length === 0;
    return {
      passed,
      detail: `covered=${data.covered_task_ids.length}/${data.total_pending_task_ids.length}`,
      data: { missing_task_ids: missing } as Record<string, unknown>,
    };
  },
} as const;
