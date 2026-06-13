import * as dotenv from "dotenv";
dotenv.config();

import type { Request, Response } from "express";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;
import { getNotion } from "../notion/client";
import { insertThought, getThoughtByNotionId } from "../db/thoughts";
import { getAlertByNotionPageId, updateAlertStatus } from "../db/alerts";
import { update_task } from "../tools/tasks";
import { handleClassify } from "./classify";

const DEFAULT_MODEL = process.env.DEFAULT_WORKER_MODEL ?? "google/gemini-2.0-flash-lite";

// Notion ids arrive dashed in the API but are often stored undashed in env.
function normalizeId(id: string | undefined | null): string {
  return (id ?? "").replace(/-/g, "").toLowerCase();
}

// Read a Notion rich_text or title property to a plain string.
function readText(prop: AnyObj | undefined): string {
  if (!prop) return "";
  const arr = prop.rich_text ?? prop.title;
  if (!Array.isArray(arr)) return "";
  return arr.map((r: AnyObj) => r.plain_text ?? "").join("");
}

function findTitleProp(props: AnyObj): AnyObj | undefined {
  for (const key of Object.keys(props ?? {})) {
    if (props[key]?.type === "title") return props[key];
  }
  return undefined;
}

// A page's parent database id (classic API) or data-source id (newer API).
function parentId(page: AnyObj): string {
  const p = page?.parent ?? {};
  return p.database_id ?? p.data_source_id ?? "";
}

/**
 * Single Notion webhook endpoint.
 *
 * Notion only allows one subscription URL per integration, delivers thin
 * payloads (ids only, no page content), and runs a one-time verification
 * handshake. This handler covers all three: it logs the full body (so the
 * verification_token can be retrieved from the logs), answers the handshake,
 * and routes real events by type + parent, fetching the page from the API to
 * get its content.
 */
export async function handleNotionWebhook(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as AnyObj;

  // Verbose: logs every incoming payload so the one-time verification_token is
  // visible in the Railway logs during setup. Trim this once verified.
  console.log("[webhook] incoming:", JSON.stringify(body));

  // Verification handshake: Notion POSTs { verification_token } exactly once.
  if (body.verification_token) {
    console.log("[webhook] *** VERIFICATION TOKEN ***:", body.verification_token);
    res.status(200).json({ ok: true });
    return;
  }

  const eventType: string = body.type ?? "";
  const pageId: string | undefined = body.entity?.id;

  if (!pageId) {
    res.status(200).json({ skipped: "no entity id" });
    return;
  }

  // Ack fast (Notion expects a prompt 2xx); process out of band.
  res.status(202).json({ received: true });

  processEvent(eventType, pageId).catch((err) =>
    console.error(`[webhook] processing failed for ${eventType} ${pageId}:`, err)
  );
}

async function processEvent(eventType: string, pageId: string): Promise<void> {
  const page = (await getNotion().pages.retrieve({ page_id: pageId })) as AnyObj;
  const parent = parentId(page);
  const thoughtsDb = process.env.NOTION_THOUGHTS_DB_ID;
  const isThoughts = !!thoughtsDb && normalizeId(parent) === normalizeId(thoughtsDb);

  if (eventType.startsWith("page.created") && isThoughts) {
    await ingestThought(pageId, page);
    return;
  }

  if (eventType === "page.properties_updated" || eventType === "page.content_updated") {
    // Alert apply is self-validating: it no-ops if the page isn't a known alert.
    await applyAlert(pageId, page);
    return;
  }

  console.log(`[webhook] no route for type=${eventType} parent=${parent}`);
}

async function ingestThought(pageId: string, page: AnyObj): Promise<void> {
  const existing = await getThoughtByNotionId(pageId);
  if (existing) {
    console.log(`[webhook] thought already ingested: ${pageId}`);
    return;
  }

  const props = page.properties ?? {};
  const content = (readText(props.content) || readText(findTitleProp(props))).trim();
  if (!content) {
    console.log(`[webhook] thought ${pageId} has empty content, skipping`);
    return;
  }

  const model = props.model?.select?.name ?? DEFAULT_MODEL;
  const thought = await insertThought({ notion_page_id: pageId, content, model });

  await handleClassify({ thought_id: thought.id, notion_page_id: pageId, content, model });
}

async function applyAlert(pageId: string, page: AnyObj): Promise<void> {
  const alert = await getAlertByNotionPageId(pageId);
  if (!alert) return; // not an alert page — ignore

  const status: string | undefined = page.properties?.status?.select?.name;
  if (!status || !["approved", "rejected", "acknowledged"].includes(status)) return;

  await updateAlertStatus(alert.id, status as "approved" | "rejected" | "acknowledged");

  if (status === "approved" && alert.type === "approval_request") {
    const payload = (alert.payload ?? {}) as { toolName?: string; args?: Record<string, unknown> };
    if (payload.toolName === "update_task" && payload.args) {
      await update_task(payload.args);
    }
  }
}
