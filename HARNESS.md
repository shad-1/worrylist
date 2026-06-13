# Worrylist — Harness

> A harness is the framework an AI agent lives inside. The agent (the *worker*) does
> one thing: given messages and tools, decide the next move. Everything else —
> what the agent is allowed to do, whether its output is acceptable, how material
> gets in and out, and what happens when something breaks — belongs to the
> **harness**, and the worker never has to think about it.

Worrylist is a personal async thought processor. You speak a worry into a Notion
database; the harness wakes a worker, the worker classifies the worry into
structured tasks, and a nightly run writes a digest. You only ever touch Notion.
The harness runs invisibly around the worker.

This document describes the harness — its four pillars, how the worker plugs into
it, how a run is persisted and replayed, and where the human gets pulled in.

---

## 1. The worker / harness split

The single source of truth for the boundary is [`src/worker/interface.ts`](src/worker/interface.ts):

```ts
export interface Worker {
  readonly model: string;
  chat(messages, tools, config, traceCtx): Promise<WorkerReply>;
}
```

That is the **entire** contract. A worker receives messages + tool schemas and
returns either text or tool calls plus token usage. It has no knowledge of
guardrails, checkpoints, alarms, Supabase, Notion, or recovery. Two
implementations satisfy the interface today:

| Worker | File | Use |
|---|---|---|
| `OpenRouterWorker` | [`src/worker/openrouter.ts`](src/worker/openrouter.ts) | Production — any OpenRouter model string (default `google/gemini-2.0-flash-lite`) |
| `MockWorker` | [`src/worker/mock.ts`](src/worker/mock.ts) | Tests + portability demo — scripted replies, zero network |

The harness is the loop and the four pillars wrapped around that call. The loop
([`src/loop/index.ts`](src/loop/index.ts)) is the only place that touches the
worker, and it does so through the interface — so swapping the worker changes
nothing else (see §7).

```
  Notion (voice-to-text thought)
        │  webhook  ── signature-verified ──┐
        ▼                                    │   MATERIAL IN
  ┌──────────────────────────────────────────────────────────────┐
  │  HARNESS                                                       │
  │                                                                │
  │   ┌── input guardrail ──┐                                      │
  │   │                     ▼                                      │
  │   │            ┌─────────────────┐   tools    ┌────────────┐  │
  │   │  loop ────▶│     WORKER      │───────────▶│  action    │  │  GUARDRAILS
  │   │            │  (swappable)    │◀───────────│  guardrail │  │
  │   │            └─────────────────┘  results   └────────────┘  │
  │   │                     │                                      │
  │   └── output guardrail ─┤                                      │
  │                         ▼                                      │
  │                  ┌────────────┐                               │
  │                  │ CHECKPOINTS│  pass/fail → persisted        │  CHECKPOINTS
  │                  └────────────┘                               │
  │                     │      │ fail                             │
  │                     │      ▼                                  │
  │                     │   ┌────────┐  structured: type,        │  ALARMS
  │                     │   │ ALARMS │  severity, context, action │
  │                     │   └────────┘                            │
  │                     ▼                                          │
  └──────────────────── tasks / digest / alerts ──────────────────┘
        │                                          │   MATERIAL OUT
        ▼                                          ▼
  Notion (Tasks, Digests, Alerts)         Langfuse (traces)  Supabase (state)
```

---

## 2. Pillar 1 — Guardrails (declared, not implicit)

**Where:** config in [`src/config/guardrails.ts`](src/config/guardrails.ts);
enforcement in [`src/guardrails/`](src/guardrails/) (`input.ts`, `action.ts`,
`output.ts`).

Every constraint is a value in one declared object — there are no rules hidden in
the worker's prompt. The agent's freedom is whatever this object says it is:

```ts
export const GUARDRAILS = {
  input:   { max_content_length: 5000, strip_prompt_injection: true,
             blocked_patterns: [/ignore previous instructions/i, /disregard.*system/i] },
  actions: { search_tasks: "allow", write_task: "allow", update_task: "conditional",
             delete_thought: "blocked", delete_task: "blocked", delete_alert: "blocked", ... },
  loop:    { max_turns: 10, max_tokens_total: 100_000, max_wall_time_ms: 60_000 },
  output:  { require_schema: true, max_length: 8000 },
};
```

The harness enforces this at **four points**, all inside the loop:

1. **Input** — [`validateInput()`](src/guardrails/input.ts) runs before the first
   model call. Over-length or injection-pattern input is rejected and never
   reaches the worker.
2. **Action** — [`applyActionGuardrail()`](src/guardrails/action.ts) runs on
   *every* tool call the worker emits, returning one of
   `allow | blocked | conditional | requires_approval`. `delete_*` is blocked;
   `update_task` is evaluated field-by-field against
   [`UPDATE_TASK_FIELD_POLICY`](src/config/guardrails.ts) (e.g. an urgency change
   *to or from* 10 escalates to `requires_approval`).
3. **Loop budget** — turn count, cumulative token budget, and wall-clock time are
   checked each turn in [`runLoop()`](src/loop/index.ts).
4. **Output** — [`validateOutput()`](src/guardrails/output.ts) runs on the final
   answer before it leaves the harness.

### The agent's behaviour changes from guardrail feedback

This is the core requirement, and it is visible in
[`src/loop/index.ts:87`](src/loop/index.ts):

- A **blocked** tool call does not throw. The harness feeds a structured result
  back to the worker as the tool's output:
  `{ error: "BLOCKED", reason: "..." }`. The worker sees the rejection in-band and
  adapts its next turn (it stops trying to delete and does something else).
- A **requires_approval** tool call is *not executed*. Instead the harness writes
  an `approval_request` alert and returns that as the tool result, so the worker
  learns "this is pending a human" and moves on rather than blocking the run.
- An **allowed** tool call executes normally.

The worker's plan genuinely bends around what the harness hands back — no prompt
engineering, just structured tool results.

---

## 3. Pillar 2 — Checkpoints (explicit pass/fail criteria)

**Where:** criteria in [`src/config/checkpoints.ts`](src/config/checkpoints.ts);
runner in [`src/checkpoints/index.ts`](src/checkpoints/index.ts).

A checkpoint is a pure function `(data) -> { passed, detail, data }` with a single,
inspectable boolean criterion. There is no fuzzy judgement:

| Checkpoint | Runs in | Pass criterion |
|---|---|---|
| `ClassificationCheckpoint` | classify | known type **AND** confidence ≥ 0.70 |
| `PriorityRangeCheckpoint` | classify | urgency & importance are integers in `[1,10]` |
| `AlertSurfacingCheckpoint` | classify | `approval_request` alert count == expected to/from-10 changes |
| `DigestCoverageCheckpoint` | digest | digest references **every** pending task id |

The runner [`runCheckpoint()`](src/checkpoints/index.ts) does three things on
every evaluation, and this is what makes checkpoints a real harness component
rather than an assertion:

1. evaluates the criterion,
2. **persists** the result to `run_logs` (`type='checkpoint'`) — see §6,
3. on failure, fires the mapped alarm (Pillar 4) and lets the caller decide
   whether to fail the run.

Checkpoints are invoked in the `validating` stage of each run:
classify runs `ClassificationCheckpoint` + `AlertSurfacingCheckpoint`
([`src/triggers/classify.ts:133`](src/triggers/classify.ts)); digest runs
`DigestCoverageCheckpoint` ([`src/triggers/digest.ts:96`](src/triggers/digest.ts)).
A failed required checkpoint throws, which flips the run to `failed` and leaves a
durable record for recovery to act on.

---

## 4. Pillar 3 — Material handling (clean interfaces in/out)

**Where:** every boundary is a typed adapter; nothing crosses raw.

The harness owns all I/O so the worker only ever sees plain strings and JSON tool
results. Material moves across four boundaries:

| Direction | Boundary | Adapter |
|---|---|---|
| **In** | Notion → harness | [`src/triggers/webhook.ts`](src/triggers/webhook.ts) — single signature-verified endpoint; fetches page content, normalises ids, dedupes, inserts a `thought` row |
| **In** | Notion auth | [`src/triggers/verify-signature.ts`](src/triggers/verify-signature.ts) — HMAC-SHA256 over the raw body with `timingSafeEqual`; the worker never runs on an unverified payload |
| **In** | harness → worker | [`src/worker/interface.ts`](src/worker/interface.ts) `Message[]` + `ToolSchema[]` — the only shape the worker understands |
| **Out** | worker → world | [`src/tools/`](src/tools/) — `write_task`, `update_task`, `write_alert`, `write_digest_page`, `read_calendar`, `search_*`. Each writes to Supabase and/or Notion via [`src/notion/client.ts`](src/notion/client.ts) |
| **Out** | observability | [`src/observability/index.ts`](src/observability/index.ts) — every model call and tool call wrapped in `withStageSpan` / `withToolSpan`, exported to Langfuse via OpenTelemetry |
| **Out** | internal state | [`src/db/`](src/db/) — typed query modules; Supabase holds runs, logs, alarms, alerts (never user-facing) |

Tool schemas are declared once in [`src/config/tools.ts`](src/config/tools.ts) and
handed to the worker; tool *executors* are wired per-run in the trigger's
`dispatch` map. The loop calls `dispatch(name, args)` and never imports a tool
directly — so the loop is generic and the same `runLoop()` serves classify and
digest with different tool sets.

---

## 5. Pillar 4 — Alarms (structured output)

**Where:** catalog + types in [`src/config/alarms.ts`](src/config/alarms.ts);
emitter in [`src/alarms/index.ts`](src/alarms/index.ts).

An alarm is never a bare log line. Every alarm is a named type carrying
`{ severity, context, recommended_action, run_id }`, persisted to the `alarm_log`
table so it is queryable and auditable:

```ts
export interface Alarm {
  type: AlarmType;            // named, enumerated
  severity: "low" | "medium" | "high" | "critical";
  context: Record<string, unknown>;
  recommended_action: string;
  run_id: string | null;
}
```

The catalog fixes severity and recommended action per type, so firing an alarm is
a one-liner that can't drift:

| Alarm | Severity | Fires when |
|---|---|---|
| `GUARDRAIL_VIOLATION` | critical | injection input, blocked tool called, or output guardrail fails |
| `CLASSIFICATION_FAILURE` | high | `ClassificationCheckpoint` fails |
| `MAX_ATTEMPTS_EXCEEDED` | high | a thought's run retried ≥ 3× without completing |
| `HIGH_URGENCY_TASK_CREATED` | high | a task lands at urgency 10 |
| `PRIORITY_RANGE_FAILURE` | medium | `PriorityRangeCheckpoint` fails |
| `DIGEST_COVERAGE_FAILURE` | medium | `DigestCoverageCheckpoint` fails |
| `TURN_LIMIT_REACHED` | medium | loop hits `max_turns` or wall-time |
| `TOKEN_BUDGET_EXCEEDED` | medium | run exceeds 100k tokens |

[`fireAlarm(type, runId, context)`](src/alarms/index.ts) looks up severity +
action from the catalog, writes the structured row, and emits a console line
tagged with severity. Checkpoints and guardrails are the primary callers, which
ties all four pillars together: a guardrail or checkpoint failure produces a
*structured, actionable* alarm, not a stack trace.

---

## 6. Checkpoint persistence & replay (resume from any stage)

A classify run moves through declared stages:

```
pending → extracting → deduplicating → writing → validating → completed
                                                            ↘ failed
```

Each stage transition and each checkpoint result is written to `run_logs` as it
happens ([`src/db/run-logs.ts`](src/db/run-logs.ts)), with the data needed to
resume in the `data` jsonb column. This makes a run **replayable**:

- A new attempt is a fresh `runs` row whose `resumed_from_run_id` points at the
  failed run.
- [`handleClassify()`](src/triggers/classify.ts:74) reads the prior run's last
  `stage_transition` via `getLastStageTransition()` and resumes from that stage
  instead of starting over — earlier stages are not re-run.
- Recovery ([`src/triggers/recovery.ts`](src/triggers/recovery.ts), Railway cron
  every 10 min) finds runs stuck past `max_wall_time_ms × 1.5`, marks them failed,
  and re-dispatches with `resumed_from_run_id` set — up to `MAX_ATTEMPTS = 3`,
  after which it fires `MAX_ATTEMPTS_EXCEEDED` and writes an error alert.

So the harness can replay a run from any checkpoint forward without re-doing prior
stages, and a crash mid-run self-heals rather than dropping the thought.

---

## 7. Swappable worker (drop-in, zero harness changes)

Because the loop only ever talks to the `Worker` interface, swapping the agent is
a one-line change at the call site and touches **nothing** in the harness:

```ts
// production
const worker = new OpenRouterWorker(model);        // any OpenRouter model string
// portability demo
const worker = new MockWorker({ text: "..." });    // scripted, offline
```

The model itself is also swappable per-thought without code: the Notion `model`
property on a thought flows through the webhook into
[`OpenRouterWorker`](src/worker/openrouter.ts), so the same harness runs
`gemini-2.0-flash-lite`, `claude-sonnet-4-6`, or `gemini-2.5-flash` against the
same input. Guardrails, checkpoints, alarms, persistence, and recovery are
identical regardless of which worker answers.

**Bonus (portability demo):** swap `OpenRouterWorker` for `MockWorker` (or change
the model string) on the same real input and watch every pillar behave
identically — the harness can't tell the difference, which is the point.

---

## 8. Human-in-the-loop escalation

The harness knows when to stop and ask rather than guess. Escalation is always a
durable `alert` row + a Notion page the user can act on:

| Trigger | Harness action | Resolution |
|---|---|---|
| `update_task` changing urgency/importance **to or from 10** | `requires_approval` → write `approval_request` alert; tool **not** executed | User flips the Notion alert to `approved`; the `page.updated` webhook re-applies the change ([`src/triggers/webhook.ts:121`](src/triggers/webhook.ts)) |
| Blocked tool / injection / budget breach | `GUARDRAIL_VIOLATION` alarm; structured rejection back to worker | Logged + auditable; worker adapts |
| Run failed 3× | `MAX_ATTEMPTS_EXCEEDED` alarm + `error` alert | User sees the failure in Notion with run id and recommended action |

The approval path is genuinely two-way: the agent's high-stakes write is parked,
the human decides in Notion, and the decision flows back in through the same
webhook boundary — the harness round-trips the human without the worker stalling.

---

## 9. Running on real input

The harness runs on the engineer's own brain-dumps — the exact thing it was built
for. The demo input is a real voice-to-text worry typed/spoken into the Notion
**Thoughts** database (e.g. *"I'm worried I forgot to renew the domain and I still
owe Sam a reply about the contract"*).

Two ways to trigger a run:

```bash
# Real path: add a row to the Notion Thoughts DB → page.created webhook → classify
# Manual path (same loop, for the demo / local testing):
curl -X POST $URL/classify \
  -H 'content-type: application/json' \
  -d '{"thought_id":"<uuid>","notion_page_id":"<id>",
       "content":"forgot to renew the domain, still owe Sam a contract reply","model":"google/gemini-2.0-flash-lite"}'
```

The run produces real Tasks pages in Notion, real `run_logs`/`alarm_log` rows in
Supabase, and a full trace in Langfuse. The nightly `/digest` run then summarises
every pending task into a Notion digest page.

---

## 10. Deployment

| Layer | Tech |
|---|---|
| Harness API | Railway — Express + TypeScript, single service ([`railway.toml`](railway.toml)) |
| Triggers | `POST /webhook/notion` (ingest + approvals), `POST /classify`, `POST /digest` (cron 02:00), `POST /recover` (cron */10 min) |
| State | Supabase (Postgres; FTS via `tsvector`) — internal only, see [`schema.sql`](schema.sql) |
| Worker | OpenRouter (OpenAI-compatible), any model string |
| I/O surface | Notion + Notion webhooks; Google Calendar MCP (read-only, digest) |
| Observability | Langfuse Cloud (OTel) |

```bash
npm install
npm test            # unit tests for all four pillars (guardrails, checkpoints, worker, loop)
npm run dev         # local
npm run build && npm start   # prod
```

---

## 11. Pillar → code quick reference

| Pillar | Declared in | Enforced/run in | Persisted to |
|---|---|---|---|
| **Guardrails** | [`src/config/guardrails.ts`](src/config/guardrails.ts) | [`src/guardrails/`](src/guardrails/) + [`src/loop/index.ts`](src/loop/index.ts) | `run_logs`, `alarm_log` (on violation) |
| **Checkpoints** | [`src/config/checkpoints.ts`](src/config/checkpoints.ts) | [`src/checkpoints/index.ts`](src/checkpoints/index.ts) | `run_logs` (`type='checkpoint'`) |
| **Material** | [`src/config/tools.ts`](src/config/tools.ts), [`src/worker/interface.ts`](src/worker/interface.ts) | [`src/triggers/`](src/triggers/), [`src/tools/`](src/tools/), [`src/observability/`](src/observability/index.ts) | Notion, Supabase, Langfuse |
| **Alarms** | [`src/config/alarms.ts`](src/config/alarms.ts) | [`src/alarms/index.ts`](src/alarms/index.ts) | `alarm_log` |
| **Worker** (governed, not part of harness) | [`src/worker/interface.ts`](src/worker/interface.ts) | [`src/worker/openrouter.ts`](src/worker/openrouter.ts), [`src/worker/mock.ts`](src/worker/mock.ts) | — |

The four pillars are four directories. The worker is a fifth, behind an interface.
That separation is the whole design.
