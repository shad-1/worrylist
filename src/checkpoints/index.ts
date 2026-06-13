import { insertRunLog } from "../db/run-logs";
import { fireAlarm } from "../alarms/index";
import { CHECKPOINTS, type CheckpointName } from "../config/checkpoints";

export async function runCheckpoint(
  name: CheckpointName,
  data: Parameters<typeof CHECKPOINTS[typeof name]>[0],
  runId: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (CHECKPOINTS[name] as (d: any) => ReturnType<typeof CHECKPOINTS[typeof name]>)(data);

  await insertRunLog({
    run_id: runId,
    type: "checkpoint",
    stage: name,
    data: { passed: result.passed, detail: result.detail, ...(result.data ?? {}) },
  });

  if (!result.passed) {
    const alarmMap: Record<CheckpointName, Parameters<typeof fireAlarm>[0]> = {
      ClassificationCheckpoint:  "CLASSIFICATION_FAILURE",
      PriorityRangeCheckpoint:   "PRIORITY_RANGE_FAILURE",
      AlertSurfacingCheckpoint:  "GUARDRAIL_VIOLATION",
      DigestCoverageCheckpoint:  "DIGEST_COVERAGE_FAILURE",
    };
    await fireAlarm(alarmMap[name], runId, { checkpoint: name, detail: result.detail });
  }

  return result.passed;
}
