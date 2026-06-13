import type { Request, Response } from "express";
import { getAlertByNotionPageId, updateAlertStatus } from "../db/alerts";
import { update_task } from "../tools/tasks";

export async function handlePageUpdated(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;

  // Verify this is an Alerts DB event
  const databaseId = (body?.parent as Record<string, unknown>)?.database_id as string;
  if (databaseId !== process.env.NOTION_ALERTS_DB_ID) {
    res.status(200).json({ skipped: true });
    return;
  }

  const notion_page_id = body.id as string;
  const properties = body.properties as Record<string, unknown>;
  const statusName = ((properties?.status as Record<string, unknown>)?.select as Record<string, unknown>)?.name as string;

  if (!["approved", "rejected", "acknowledged"].includes(statusName)) {
    res.status(200).json({ skipped: true, reason: "status not actionable" });
    return;
  }

  const alert = await getAlertByNotionPageId(notion_page_id);
  if (!alert) {
    res.status(404).json({ error: "alert not found" });
    return;
  }

  await updateAlertStatus(alert.id, statusName as "approved" | "rejected" | "acknowledged");

  if (statusName === "approved" && alert.type === "approval_request") {
    const payload = alert.payload as { toolName?: string; args?: Record<string, unknown> };
    if (payload.toolName === "update_task" && payload.args) {
      await update_task(payload.args);
    }
  }

  res.status(200).json({ alert_id: alert.id, status: statusName });
}
