import { insertTask, updateTask, insertThoughtTask, type TaskRecord } from "../db/tasks";
import { getNotion, richText } from "../notion/client";

// Map a (partial) task record to Notion Tasks-DB property values. Only fields
// that are present are emitted, so this works for both create and update.
function taskProperties(fields: Partial<TaskRecord>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (fields.title !== undefined) props.title = { title: richText(fields.title) };
  if (fields.description !== undefined && fields.description !== null) {
    props.description = { rich_text: richText(fields.description) };
  }
  if (fields.type !== undefined && fields.type !== null) props.type = { select: { name: fields.type } };
  if (fields.urgency !== undefined && fields.urgency !== null) props.urgency = { number: fields.urgency };
  if (fields.importance !== undefined && fields.importance !== null) props.importance = { number: fields.importance };
  if (fields.want_done_at) props.want_done_at = { date: { start: fields.want_done_at } };
  if (fields.need_done_at) props.need_done_at = { date: { start: fields.need_done_at } };
  if (fields.status !== undefined) props.status = { select: { name: fields.status } };
  return props;
}

async function notionCreateTaskPage(task: Partial<TaskRecord>): Promise<string> {
  const database_id = process.env.NOTION_TASKS_DB_ID;
  if (!database_id) throw new Error("NOTION_TASKS_DB_ID must be set");
  const page = await getNotion().pages.create({
    parent: { database_id },
    properties: taskProperties(task) as never,
  });
  return page.id;
}

async function notionUpdateTaskPage(notion_page_id: string, fields: Partial<TaskRecord>): Promise<void> {
  await getNotion().pages.update({
    page_id: notion_page_id,
    properties: taskProperties(fields) as never,
  });
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
