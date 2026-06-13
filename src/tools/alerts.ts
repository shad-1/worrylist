import { insertAlert } from "../db/alerts";

async function notionCreateAlertPage(params: {
  title: string;
  type: string;
  payload: Record<string, unknown>;
  run_id: string;
}): Promise<string> {
  console.log("[notion] create_page alert:", params.title);
  // TODO(Railway): replace with actual Notion MCP call
  return "notion-alert-placeholder-id";
}

export async function write_alert(args: Record<string, unknown>, run_id: string) {
  const { type, title, payload } = args as {
    type: "error" | "approval_request" | "change_notification";
    title: string;
    payload: Record<string, unknown>;
  };

  const notion_page_id = await notionCreateAlertPage({ title, type, payload, run_id });
  const alert = await insertAlert({ run_id, type, payload, notion_page_id });

  return { alert_id: alert.id, notion_page_id };
}
