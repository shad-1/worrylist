import * as dotenv from "dotenv";
dotenv.config();

import { OpenRouterWorker } from "../worker/openrouter";
import { runLoop } from "../loop/index";
import { insertRun, updateRun, countAttempts } from "../db/runs";
import { insertRunLog, getLastStageTransition } from "../db/run-logs";
import { updateThoughtStatus } from "../db/thoughts";
import { runCheckpoint } from "../checkpoints/index";
import { fireAlarm } from "../alarms/index";
import { withStageSpan } from "../observability/index";
import { TOOL_SCHEMAS } from "../config/tools";
import { search_thoughts, search_tasks } from "../tools/search";
import { write_task, update_task } from "../tools/tasks";
import { update_thought_status } from "../tools/thoughts";
import { write_alert } from "../tools/alerts";
import { delete_thought, delete_task, delete_alert } from "../tools/blocked";
import type { LoopResult } from "../loop/index";

const MAX_ATTEMPTS = 3;

const CLASSIFY_SYSTEM_PROMPT = `You are a personal assistant processing voice-to-text thoughts.
Your job is to extract discrete tasks from the thought text, check if they already exist,
then create or update task records accordingly.

For each task you identify:
1. Search for existing tasks using search_tasks to check for duplicates
2. If found: use update_task to reflect any changes in urgency, importance, or dates
3. If not found: use write_task to create it

Assign:
- type: task | question | idea | concern | note
- urgency: integer 1-10 (10 = drop everything)
- importance: integer 1-10 (10 = defines success)
- confidence: 0.0-1.0 (your certainty in the classification)

When done with all tasks, respond with a JSON summary:
{"processed": <count>, "created": <count>, "updated": <count>}`;

type ClassifyStage = "extracting" | "deduplicating" | "writing" | "validating";

interface ClassifyState {
  stage: ClassifyStage;
  thought_id: string;
  candidates?: Array<{ title: string; description: string; type: string; urgency: number; importance: number; confidence: number }>;
  written_task_ids?: string[];
  expected_approval_count?: number;
}

export async function handleClassify(params: {
  thought_id: string;
  notion_page_id: string;
  content: string;
  model?: string;
  resumed_from_run_id?: string;
}): Promise<void> {
  const { thought_id, content, model, resumed_from_run_id } = params;

  const attemptCount = await countAttempts(thought_id);
  if (attemptCount >= MAX_ATTEMPTS) {
    await fireAlarm("MAX_ATTEMPTS_EXCEEDED", "none", { thought_id, attempts: attemptCount });
    return;
  }

  const worker = new OpenRouterWorker(model);
  const run = await insertRun({
    thought_id,
    trigger_type: "classify",
    worker_model: worker.model,
    resumed_from_run_id,
  });
  const runId = run.id;

  // Determine resume point
  let resumeStage: ClassifyStage = "extracting";
  let resumeState: Partial<ClassifyState> = {};
  if (resumed_from_run_id) {
    const lastLog = await getLastStageTransition(resumed_from_run_id);
    if (lastLog?.stage) {
      resumeStage = lastLog.stage as ClassifyStage;
      resumeState = (lastLog.data ?? {}) as Partial<ClassifyState>;
    }
  }

  const toolDispatch = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const dispatchers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
      search_thoughts,
      search_tasks,
      write_task: (a) => write_task({ ...a, thought_id }),
      update_task,
      update_thought_status,
      write_alert: (a) => write_alert(a, runId),
      delete_thought,
      delete_task,
      delete_alert,
    };
    const fn = dispatchers[toolName];
    if (!fn) return { error: `Unknown tool: ${toolName}` };
    return fn(args);
  };

  const classifyTools = Object.values(TOOL_SCHEMAS).filter(t =>
    !["write_digest_page", "read_calendar"].includes(t.name)
  );

  try {
    await updateThoughtStatus(thought_id, "processing");

    let loopResult: LoopResult | undefined;

    // Run the loop — it handles dedup and writes internally via tool calls
    if (resumeStage === "extracting") {
      await updateRun(runId, { status: "extracting" });
      await insertRunLog({ run_id: runId, type: "stage_transition", stage: "extracting", data: { thought_id } });

      loopResult = await withStageSpan("extracting", runId, () =>
        runLoop({
          worker,
          systemPrompt: CLASSIFY_SYSTEM_PROMPT,
          userInput: content,
          tools: classifyTools,
          runId,
          triggerType: "classify",
          dispatch: toolDispatch,
        })
      );
    }

    // Validating stage
    await updateRun(runId, { status: "validating" });
    await insertRunLog({ run_id: runId, type: "stage_transition", stage: "validating", data: {} });

    await withStageSpan("validating", runId, async () => {
      // ClassificationCheckpoint: parse summary from loop result
      let loopSummary = { processed: 0, created: 0, updated: 0 };
      try {
        loopSummary = JSON.parse(loopResult?.text ?? "{}");
      } catch { /* non-JSON reply — checkpoint will fail */ }

      const classificationPassed = await runCheckpoint(
        "ClassificationCheckpoint",
        { type: "task", confidence: loopSummary.processed > 0 ? 0.9 : 0.0 },
        runId
      );

      // AlertSurfacingCheckpoint: count approval_request alerts for this run
      const { data: alertRows } = await import("../db/client").then(({ db }) =>
        db.from("alerts").select("id").eq("run_id", runId).eq("type", "approval_request")
      );
      const actualApprovalCount = alertRows?.length ?? 0;
      const expectedApprovalCount = resumeState.expected_approval_count ?? actualApprovalCount;

      const alertPassed = await runCheckpoint(
        "AlertSurfacingCheckpoint",
        { expected_approval_count: expectedApprovalCount, actual_approval_count: actualApprovalCount },
        runId
      );

      if (!classificationPassed || !alertPassed) {
        throw new Error("Checkpoint failure");
      }
    });

    await updateThoughtStatus(thought_id, "completed");
    await updateRun(runId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      turns_used: loopResult?.turns ?? 0,
      tokens_in: loopResult?.tokensIn ?? 0,
      tokens_out: loopResult?.tokensOut ?? 0,
    });

  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: "failed", failure_reason: reason, completed_at: new Date().toISOString() });
    await insertRunLog({ run_id: runId, type: "error", data: { error: reason } });
    await updateThoughtStatus(thought_id, "failed");
    throw err;
  }
}
