import { db } from "./client";

export type RunLogType = "stage_transition" | "checkpoint" | "error";

export interface RunLog {
  id: string;
  run_id: string;
  type: RunLogType;
  stage: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export async function insertRunLog(params: {
  run_id: string;
  type: RunLogType;
  stage?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.from("run_logs").insert(params);
  if (error) throw new Error(`insertRunLog: ${error.message}`);
}

export async function getLastStageTransition(run_id: string): Promise<RunLog | null> {
  const { data, error } = await db
    .from("run_logs")
    .select()
    .eq("run_id", run_id)
    .eq("type", "stage_transition")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLastStageTransition: ${error.message}`);
  return data as RunLog | null;
}
