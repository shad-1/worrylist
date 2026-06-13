import { searchTasks } from "../db/tasks";
import { db } from "../db/client";

export async function search_thoughts(args: Record<string, unknown>) {
  const query = args.query as string;
  const limit = (args.limit as number | undefined) ?? 5;
  const { data, error } = await (db as any)
    .from("thoughts")
    .select("id, content, status, created_at")
    .textSearch("content", query)
    .limit(limit);
  if (error) return { error: error.message };
  return { results: data ?? [] };
}

export async function search_tasks(args: Record<string, unknown>) {
  const query = args.query as string;
  const limit = (args.limit as number | undefined) ?? 5;
  const results = await searchTasks(query, limit);
  return { results };
}
