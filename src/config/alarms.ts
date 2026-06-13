export type AlarmType =
  | "GUARDRAIL_VIOLATION"
  | "CLASSIFICATION_FAILURE"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "HIGH_URGENCY_TASK_CREATED"
  | "PRIORITY_RANGE_FAILURE"
  | "DIGEST_COVERAGE_FAILURE"
  | "TURN_LIMIT_REACHED"
  | "TOKEN_BUDGET_EXCEEDED";

export type AlarmSeverity = "low" | "medium" | "high" | "critical";

export interface Alarm {
  type: AlarmType;
  severity: AlarmSeverity;
  context: Record<string, unknown>;
  recommended_action: string;
  run_id: string;
}

export const ALARM_CATALOG: Record<AlarmType, { severity: AlarmSeverity; recommended_action: string }> = {
  GUARDRAIL_VIOLATION:       { severity: "critical", recommended_action: "Inspect input and review run" },
  CLASSIFICATION_FAILURE:    { severity: "high",     recommended_action: "Manually classify tasks for this thought" },
  MAX_ATTEMPTS_EXCEEDED:     { severity: "high",     recommended_action: "Inspect run logs for failure cause" },
  HIGH_URGENCY_TASK_CREATED: { severity: "high",     recommended_action: "Review new urgency-10 task immediately" },
  PRIORITY_RANGE_FAILURE:    { severity: "medium",   recommended_action: "Re-run classification for this thought" },
  DIGEST_COVERAGE_FAILURE:   { severity: "medium",   recommended_action: "Check tasks table for orphaned records" },
  TURN_LIMIT_REACHED:        { severity: "medium",   recommended_action: "Inspect run, thought may be too complex" },
  TOKEN_BUDGET_EXCEEDED:     { severity: "medium",   recommended_action: "Inspect run, reduce thought batch size" },
};
