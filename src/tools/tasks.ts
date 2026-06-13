import { insertTask, updateTask, insertThoughtTask, type TaskRecord } from "../db/tasks";

// Notion MCP call helper — wraps MCP tool calls
// In Claude Code, MCP tools are available globally. In production Railway,
// the Notion MCP runs as a sidecar and is called via HTTP or stdio.
// For now, stub with console.log — replace with actual MCP invocation.
async function notionCreateTaskPage(task: Partial<TaskRecord>): Promise<string> {
  console.log("[notion] create_page task:", task.title);
  // TODO(Railway): replace with actual Notion MCP call
  // mcp__notion__create_page({ parent: { database_id: NOTION_TASKS_DB_ID }, properties: {...} })
  return "notion-placeholder-id";
}

async function notionUpdateTaskPage(notion_page_id: string, fields: Partial<TaskRecord>): Promise<void> {
  console.log("[notion] update_page task:", notion_page_id, fields);
  // TODO(Railway): replace with actual Notion MCP call
}

export async function write_task(args: Record<string, unknown>) {
  const { thought_id, confidence, ...taskFields } = args as {
    thought_id: string;
    confidence: number;
    title: string;
    type: TaskRecord["type"];
    urgency: number;
    importance: number;
    description?: string;
    want_done_at?: string;
    need_done_at?: string;
  };

  const task = await insertTask({
    notion_page_id: null,
    title: taskFields.title,
    description: taskFields.description ?? null,
    type: taskFields.type,
    urgency: taskFields.urgency,
    importance: taskFields.importance,
    want_done_at: taskFields.want_done_at ?? null,
    need_done_at: taskFields.need_done_at ?? null,
    status: "pending",
  });

  const notion_page_id = await notionCreateTaskPage(task);
  await updateTask(task.id, { notion_page_id });
  await insertThoughtTask(thought_id, task.id);

  return { task_id: task.id, notion_page_id, confidence };
}

export async function update_task(args: Record<string, unknown>) {
  const { task_id, fields } = args as { task_id: string; fields: Partial<TaskRecord> };
  const updated = await updateTask(task_id, fields);
  if (updated.notion_page_id) {
    await notionUpdateTaskPage(updated.notion_page_id, fields);
  }
  return { task_id, updated_fields: Object.keys(fields) };
}
