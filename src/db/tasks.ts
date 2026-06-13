import { db } from "./client";

export interface TaskRecord {
  id: string;
  notion_page_id: string | null;
  title: string;
  description: string | null;
  type: "task" | "question" | "idea" | "concern" | "note" | null;
  urgency: number | null;
  importance: number | null;
  want_done_at: string | null;
  need_done_at: string | null;
  status: "pending" | "scheduled" | "done" | "cancelled";
  created_at: string;
  updated_at: string;
}

export async function searchTasks(query: string, limit = 5): Promise<TaskRecord[]> {
  const { data, error } = await db
    .from("tasks")
    .select()
    .textSearch("search_vector", query, { type: "plain", config: "english" })
    .limit(limit);
  if (error) throw new Error(`searchTasks: ${error.message}`);
  return (data ?? []) as TaskRecord[];
}

export async function insertTask(params: Omit<TaskRecord, "id" | "created_at" | "updated_at">): Promise<TaskRecord> {
  const { data, error } = await db.from("tasks").insert(params).select().single();
  if (error) throw new Error(`insertTask: ${error.message}`);
  return data as TaskRecord;
}

export async function updateTask(
  id: string,
  fields: Partial<Omit<TaskRecord, "id" | "created_at" | "updated_at">>
): Promise<TaskRecord> {
  const { data, error } = await db.from("tasks").update(fields).eq("id", id).select().single();
  if (error) throw new Error(`updateTask: ${error.message}`);
  return data as TaskRecord;
}

export async function getPendingTasks(): Promise<TaskRecord[]> {
  const { data, error } = await db.from("tasks").select().eq("status", "pending");
  if (error) throw new Error(`getPendingTasks: ${error.message}`);
  return (data ?? []) as TaskRecord[];
}

export async function insertThoughtTask(thought_id: string, task_id: string): Promise<void> {
  const { error } = await db.from("thought_tasks").insert({ thought_id, task_id });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`insertThoughtTask: ${error.message}`);
  }
}
