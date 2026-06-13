import { db } from "./client";

export interface AlertRecord {
  id: string;
  notion_page_id: string | null;
  run_id: string | null;
  type: "error" | "approval_request" | "change_notification";
  status: "pending" | "acknowledged" | "approved" | "rejected";
  payload: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
}

export async function insertAlert(params: {
  run_id: string;
  type: AlertRecord["type"];
  payload: Record<string, unknown>;
  notion_page_id?: string;
}): Promise<AlertRecord> {
  const { data, error } = await db.from("alerts").insert(params).select().single();
  if (error) throw new Error(`insertAlert: ${error.message}`);
  return data as AlertRecord;
}

export async function updateAlertStatus(
  id: string,
  status: AlertRecord["status"],
  notion_page_id?: string
): Promise<void> {
  const fields: Partial<AlertRecord> = { status };
  if (notion_page_id) fields.notion_page_id = notion_page_id;
  if (status === "approved" || status === "rejected") {
    fields.resolved_at = new Date().toISOString();
  }
  const { error } = await db.from("alerts").update(fields).eq("id", id);
  if (error) throw new Error(`updateAlertStatus: ${error.message}`);
}

export async function getAlertByNotionPageId(notion_page_id: string): Promise<AlertRecord | null> {
  const { data, error } = await db
    .from("alerts")
    .select()
    .eq("notion_page_id", notion_page_id)
    .maybeSingle();
  if (error) throw new Error(`getAlertByNotionPageId: ${error.message}`);
  return data as AlertRecord | null;
}
