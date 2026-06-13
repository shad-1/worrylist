import { insertAlert } from "../db/alerts";
import { getNotion, richText } from "../notion/client";

async function notionCreateAlertPage(params: {
  title: string;
  type: string;
  payload: Record<string, unknown>;
  run_id: string;
}): Promise<string> {
  const database_id = process.env.NOTION_ALERTS_DB_ID;
  if (!database_id) throw new Error("NOTION_ALERTS_DB_ID must be set");
  const page = await getNotion().pages.create({
    parent: { database_id },
    properties: {
      title: { title: richText(params.title) },
      type: { select: { name: params.type } },
      status: { select: { name: "pending" } },
      payload: { rich_text: richText(JSON.stringify(params.payload)) },
      run_id: { rich_text: richText(params.run_id) },
      created_at: { date: { start: new Date().toISOString() } },
    } as never,
  });
  return page.id;
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
