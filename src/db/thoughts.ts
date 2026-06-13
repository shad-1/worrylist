import { db } from "./client";

export interface ThoughtRecord {
  id: string;
  notion_page_id: string;
  content: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
}

export async function insertThought(params: {
  notion_page_id: string;
  content: string;
  model: string;
}): Promise<ThoughtRecord> {
  const { data, error } = await db
    .from("thoughts")
    .insert(params)
    .select()
    .single();
  if (error) throw new Error(`insertThought: ${error.message}`);
  return data as ThoughtRecord;
}

export async function updateThoughtStatus(
  id: string,
  status: ThoughtRecord["status"]
): Promise<void> {
  const { error } = await db.from("thoughts").update({ status }).eq("id", id);
  if (error) throw new Error(`updateThoughtStatus: ${error.message}`);
}

export async function getThoughtByNotionId(notion_page_id: string): Promise<ThoughtRecord | null> {
  const { data, error } = await db
    .from("thoughts")
    .select()
    .eq("notion_page_id", notion_page_id)
    .maybeSingle();
  if (error) throw new Error(`getThoughtByNotionId: ${error.message}`);
  return data as ThoughtRecord | null;
}
