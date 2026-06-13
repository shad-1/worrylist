import * as dotenv from "dotenv";
dotenv.config();

import { getStuckRuns, countAttempts } from "../db/runs";
import { fireAlarm } from "../alarms/index";
import { write_alert } from "../tools/alerts";
import { handleClassify } from "./classify";
import { GUARDRAILS } from "../config/guardrails";
import { db } from "../db/client";

const MAX_ATTEMPTS = 3;

export async function handleRecovery(): Promise<void> {
  const stuckRuns = await getStuckRuns(GUARDRAILS.loop.max_wall_time_ms * 1.5);

  for (const run of stuckRuns) {
    if (!run.thought_id) {
      // Digest or recovery run — do not retry, just fail and alert
      await db.from("runs").update({ status: "failed", failure_reason: "recovery: no thought_id, auto-failed" }).eq("id", run.id);
      await write_alert({
        type: "error",
        title: `Digest/recovery run stuck: ${run.id}`,
        payload: { run_id: run.id, status: run.status, trigger_type: run.trigger_type },
      }, run.id);
      continue;
    }

    const attempts = await countAttempts(run.thought_id);

    if (attempts >= MAX_ATTEMPTS) {
      await db.from("runs").update({ status: "failed", failure_reason: "recovery: max attempts exceeded" }).eq("id", run.id);
      await fireAlarm("MAX_ATTEMPTS_EXCEEDED", run.id, { thought_id: run.thought_id, attempts });
      await write_alert({
        type: "error",
        title: `Run failed after ${attempts} attempts`,
        payload: { run_id: run.id, thought_id: run.thought_id },
      }, run.id);
      continue;
    }

    // Fetch thought content for resume
    const { data: thought } = await db.from("thoughts").select().eq("id", run.thought_id).single();
    if (!thought) continue;

    // Mark current run as failed before spawning retry
    await db.from("runs").update({ status: "failed", failure_reason: "recovery: timed out, retrying" }).eq("id", run.id);

    // Resume: new run record, points back to failed run for checkpoint replay
    await handleClassify({
      thought_id: thought.id,
      notion_page_id: thought.notion_page_id,
      content: thought.content,
      model: thought.model,
      resumed_from_run_id: run.id,
    }).catch(err => {
      console.error(`Recovery failed for run ${run.id}:`, err);
    });
  }
}
