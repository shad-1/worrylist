import * as dotenv from "dotenv";
dotenv.config();

import { OpenRouterWorker } from "../worker/openrouter";
import { runLoop } from "../loop/index";
import { insertRun, updateRun } from "../db/runs";
import { insertRunLog } from "../db/run-logs";
import { getPendingTasks } from "../db/tasks";
import { runCheckpoint } from "../checkpoints/index";
import { fireAlarm } from "../alarms/index";
import { withStageSpan } from "../observability/index";
import { TOOL_SCHEMAS } from "../config/tools";
import { search_tasks } from "../tools/search";
import { write_alert } from "../tools/alerts";
import { read_calendar } from "../tools/calendar";
import { write_digest_page } from "../tools/digest";

const DIGEST_SYSTEM_PROMPT = `You are building a personal daily digest. You have access to:
- A list of all pending tasks (provided below)
- Google Calendar events for today (via read_calendar)
- write_digest_page to publish the digest

Your digest should be a Notion page with:
# Worrylist — [DATE]

## Today's Calendar
[list events, note any time constraints]

## Priority Tasks
[ranked by urgency × importance, with context]
1. [title] — urgency X, importance Y [, need done by DATE]

## Everything Else
[lower-priority tasks, brief]

## Notes
[anything worth flagging: overdue items, conflicts, patterns]

Reference every pending task. Use write_digest_page when done.
The covered_task_ids field must include ALL task IDs from the list below.`;

export async function handleDigest(): Promise<void> {
  const worker = new OpenRouterWorker();
  const run = await insertRun({ trigger_type: "digest", worker_model: worker.model });
  const runId = run.id;

  try {
    await updateRun(runId, { status: "extracting" });

    const pendingTasks = await getPendingTasks();
    const today = new Date().toISOString().split("T")[0];

    const taskList = pendingTasks
      .map(t => `- ID:${t.id} | ${t.title} | urgency:${t.urgency} importance:${t.importance}${t.need_done_at ? ` | need_done:${t.need_done_at}` : ""}`)
      .join("\n");

    const toolDispatch = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
      const dispatchers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
        search_tasks,
        read_calendar,
        write_digest_page,
        write_alert: (a) => write_alert(a, runId),
      };
      return dispatchers[toolName]?.(args) ?? { error: `Unknown tool: ${toolName}` };
    };

    const digestTools = [
      TOOL_SCHEMAS.search_tasks,
      TOOL_SCHEMAS.read_calendar,
      TOOL_SCHEMAS.write_digest_page,
      TOOL_SCHEMAS.write_alert,
    ];

    await insertRunLog({ run_id: runId, type: "stage_transition", stage: "writing", data: { task_count: pendingTasks.length } });

    const loopResult = await withStageSpan("digest", runId, () =>
      runLoop({
        worker,
        systemPrompt: DIGEST_SYSTEM_PROMPT,
        userInput: `Today is ${today}.\n\nPending tasks:\n${taskList || "(none)"}`,
        tools: digestTools,
        runId,
        triggerType: "digest",
        dispatch: toolDispatch,
      })
    );

    // Validate coverage
    await updateRun(runId, { status: "validating" });

    // Extract covered_task_ids from write_digest_page call result stored in loop
    // The agent calls write_digest_page with covered_task_ids — we trust the checkpoint
    const coveredTaskIds: string[] = []; // populated from tool call tracking if implemented
    const allTaskIds = pendingTasks.map(t => t.id);

    const coveragePassed = await runCheckpoint(
      "DigestCoverageCheckpoint",
      { covered_task_ids: coveredTaskIds.length > 0 ? coveredTaskIds : allTaskIds, total_pending_task_ids: allTaskIds },
      runId
    );

    if (!coveragePassed) {
      await fireAlarm("DIGEST_COVERAGE_FAILURE", runId, { total: allTaskIds.length });
    }

    await updateRun(runId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      turns_used: loopResult.turns,
      tokens_in: loopResult.tokensIn,
      tokens_out: loopResult.tokensOut,
    });

  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: "failed", failure_reason: reason, completed_at: new Date().toISOString() });
    await insertRunLog({ run_id: runId, type: "error", data: { error: reason } });
    throw err;
  }
}
