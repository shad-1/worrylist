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

// A page's parent database id (classic API) or data-source id (newer API).
function parentId(page: AnyObj): string {
  const p = page?.parent ?? {};
  return p.database_id ?? p.data_source_id ?? "";
}

// Concatenate the page's body text. Thoughts are typed into the page body, so
// the text lives in child blocks — pages.retrieve returns properties only.
async function readPageText(pageId: string): Promise<string> {
  const res = (await getNotion().blocks.children.list({ block_id: pageId, page_size: 100 })) as AnyObj;
  const parts: string[] = [];
  for (const block of res.results ?? []) {
    const b = block as AnyObj;
    const rich = b[b.type]?.rich_text;
    if (Array.isArray(rich)) parts.push(rich.map((r: AnyObj) => r.plain_text ?? "").join(""));
  }
  return parts.join("\n");
}

/**
 * Single Notion webhook endpoint.
 *
 * Notion allows one subscription URL per integration, delivers thin payloads
 * (ids only, no page content), and runs a one-time verification handshake.
 * This handler logs the full body (so the verification_token is retrievable
 * from the logs), answers the handshake, and routes real events by parent,
 * fetching the page/blocks from the API to get content.
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

  // Thoughts: the user types into the page body, and the text usually lands a
  // moment AFTER page.created (arriving as page.content_updated). Route every
  // thought-page event to the idempotent ingest path.
  if (isThoughts) {
    await ingestThought(pageId, page);
    return;
  }

  // Otherwise it may be an alert page whose status the user just changed.
  if (eventType === "page.properties_updated" || eventType === "page.content_updated") {
    await applyAlert(pageId, page);
    return;
  }

  console.log(`[webhook] no route for type=${eventType} parent=${parent}`);
}

async function ingestThought(pageId: string, page: AnyObj): Promise<void> {
  // Idempotent: a thought page emits several events (created + content updates);
  // only the first that finds non-empty body text ingests + classifies.
  const existing = await getThoughtByNotionId(pageId);
  if (existing) {
    console.log(`[webhook] thought already ingested: ${pageId}`);
    return;
  }

  const content = (await readPageText(pageId)).trim();
  if (!content) {
    console.log(`[webhook] thought ${pageId} body empty, will ingest on next update`);
    return;
  }

  const model = page.properties?.model?.select?.name ?? DEFAULT_MODEL;
  const thought = await insertThought({ notion_page_id: pageId, content, model });
  console.log(`[webhook] ingested thought ${thought.id}, classifying...`);
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
