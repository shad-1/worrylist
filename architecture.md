# Worrylist
### Architecture

Voice-to-text thoughts in, structured tasks and a nightly digest out. The harness runs invisibly — you interact only with Notion.

---

## Notion (user-facing)

| Page | Type | Purpose |
|---|---|---|
| Thoughts | Database | User input. `content`, `model` (select, default: `google/gemini-2.0-flash-lite`), `status`, `created_at` |
| Tasks | Database | Agent-maintained. `title`, `type`, `urgency/importance (1–10)`, `want_done_at`, `need_done_at`, `status` |
| Digests | Page list | One agent-written markdown page per night |
| Alerts | Database | Errors, approval requests, change notifications. `type`, `status`, `payload` |

---

## Supabase (internal)

```
thoughts      id, notion_page_id, content, model, status (pending|processing|completed|failed), created_at
tasks         id, notion_page_id, title, description,
              search_vector tsvector GENERATED (GIN index, Postgres FTS),
              type, urgency int [1–10], importance int [1–10],
              want_done_at, need_done_at,
              status (pending|scheduled|done|cancelled), created_at, updated_at
thought_tasks thought_id → task_id  (many-to-many)
runs          id, thought_id (nullable), trigger_type (classify|digest|recovery|manual),
              status (pending|extracting|deduplicating|writing|validating|completed|failed),
              failure_reason, resumed_from_run_id, worker_model,
              turns_used, tokens_in, tokens_out, started_at, completed_at
run_logs      id, run_id, type (stage_transition|checkpoint|error), stage, data jsonb, created_at
alarm_log     id, run_id, type, severity (low|medium|high|critical),
              context jsonb, recommended_action, created_at
alerts        id, notion_page_id, run_id,
              type (error|approval_request|change_notification),
              status (pending|acknowledged|approved|rejected),
              payload jsonb, created_at, resolved_at
```

---

## Services (single Railway deployment, Express + TypeScript)

```
POST /webhook/notion/page-created   Notion push → insert thought record → POST /classify (async)
POST /webhook/notion/page-updated   Notion push → apply or discard approval from alerts payload
POST /classify                      Classify loop  (also callable manually for testing)
POST /digest                        Digest loop    [Railway cron: 2am daily]
POST /recover                       Recovery loop  [Railway cron: every 10 min]
```

---

## Classify Loop

```
pending → extracting → deduplicating → writing → validating → completed
                                                             ↘ failed
```

Each stage writes a `run_log` row (`type='stage_transition'`) with the data needed to resume. Recovery resumes from the last logged stage. One run record per attempt, linked by `thought_id`. Max attempts: 3 before forced `failed` + alert.

**Limits:** 10 turns · 100k tokens · 60s wall time

**Stage notes:**
- `extracting` — agent reads thought, produces candidate task list. Crash here = restart from scratch.
- `deduplicating` — FTS search per candidate, resolves to create or update.
- `writing` — executes creates/updates, fires alerts per field-level guardrail.
- `validating` — runs all classify checkpoints. Failure → `failed` + alarm.

---

## Tools

| Tool | Policy |
|---|---|
| `search_thoughts`, `search_tasks` | allow — Postgres FTS against Supabase |
| `read_calendar` | allow — Google Calendar MCP, read-only |
| `write_task`, `write_alert`, `write_digest_page`, `update_thought_status` | allow |
| `update_task` | conditional — urgency/importance to or from 10 → `approval_request` alert + continues; other fields → write + `change_notification` alert |
| `delete_thought`, `delete_task`, `delete_alert` | blocked — returns structured `BLOCKED` error to agent |

---

## Guardrails

```typescript
const GUARDRAILS = {
  input:   { max_content_length: 5000, strip_prompt_injection: true },
  actions: { 'delete_*': 'blocked', update_task: 'conditional', _default: 'allow' },
  loop:    { max_turns: 10, max_tokens_total: 100_000, max_wall_time_ms: 60_000 },
  output:  { require_schema: true, max_length: 8000 },
}
```

---

## Checkpoints

| Checkpoint | Runs in | Criteria |
|---|---|---|
| `ClassificationCheckpoint` | classify | known type AND confidence ≥ 0.70 |
| `PriorityRangeCheckpoint` | classify | urgency + importance are integers in [1, 10] |
| `AlertSurfacingCheckpoint` | classify | `approval_request` alert count = count of to/from-10 field changes in writing stage log |
| `DigestCoverageCheckpoint` | digest | digest references every pending task from Supabase |

---

## Alarms

| Alarm | Severity | Fires When |
|---|---|---|
| `GUARDRAIL_VIOLATION` | critical | Injection attempt or blocked tool called |
| `CLASSIFICATION_FAILURE` | high | `ClassificationCheckpoint` fails after max attempts |
| `MAX_ATTEMPTS_EXCEEDED` | high | Run retried ≥ 3 times without completing |
| `HIGH_URGENCY_TASK_CREATED` | high | Task created or updated with urgency = 10 |
| `PRIORITY_RANGE_FAILURE` | medium | `PriorityRangeCheckpoint` fails |
| `DIGEST_COVERAGE_FAILURE` | medium | `DigestCoverageCheckpoint` fails |
| `TURN_LIMIT_REACHED` | medium | Loop hits `max_turns` |
| `TOKEN_BUDGET_EXCEEDED` | medium | Run exceeds 100k tokens |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Harness API | Railway (Express, TypeScript) |
| Database | Supabase (Postgres — FTS via `tsvector`) |
| Worker | OpenRouter — any model string. Default: `google/gemini-2.0-flash-lite` (verify string at openrouter.ai/models) |
| Frontend / IO | Notion + Notion MCP + Notion Webhooks (developer portal) |
| Calendar | Google Calendar MCP (read-only, digest only) |
| Observability | Langfuse Cloud — traces every model call and tool call |
