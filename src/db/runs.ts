import { db } from "./client";

export type RunStatus =
  | "pending" | "extracting" | "deduplicating"
  | "writing" | "validating" | "completed" | "failed";

export type TriggerType = "classify" | "digest" | "recovery" | "manual";

export interface RunRecord {
  id: string;
  thought_id: string | null;
  trigger_type: TriggerType;
  status: RunStatus;
  failure_reason: string | null;
  resumed_from_run_id: string | null;
  worker_model: string | null;
  turns_used: number;
  tokens_in: number;
  tokens_out: number;
  started_at: string;
  completed_at: string | null;
}

export async function insertRun(params: {
  thought_id?: string;
  trigger_type: TriggerType;
  worker_model: string;
  resumed_from_run_id?: string;
}): Promise<RunRecord> {
  const { data, error } = await db.from("runs").insert(params).select().single();
  if (error) throw new Error(`insertRun: ${error.message}`);
  return data as RunRecord;
}

export async function updateRun(
  id: string,
  fields: Partial<Pick<RunRecord, "status" | "failure_reason" | "turns_used" | "tokens_in" | "tokens_out" | "completed_at">>
): Promise<void> {
  const { error } = await db.from("runs").update(fields).eq("id", id);
  if (error) throw new Error(`updateRun: ${error.message}`);
}

export async function countAttempts(thought_id: string): Promise<number> {
  const { count, error } = await db
    .from("runs")
    .select("*", { count: "exact", head: true })
    .eq("thought_id", thought_id);
  if (error) throw new Error(`countAttempts: ${error.message}`);
  return count ?? 0;
}

export async function getStuckRuns(timeoutMs: number): Promise<RunRecord[]> {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const { data, error } = await db
    .from("runs")
    .select()
    .in("status", ["pending", "extracting", "deduplicating", "writing", "validating"])
    .lt("started_at", cutoff);
  if (error) throw new Error(`getStuckRuns: ${error.message}`);
  return (data ?? []) as RunRecord[];
}
