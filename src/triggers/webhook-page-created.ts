import type { Request, Response } from "express";
import { insertThought, getThoughtByNotionId } from "../db/thoughts";
import { handleClassify } from "./classify";

export async function handlePageCreated(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;

  // Verify this is a Thoughts DB event
  const databaseId = (body?.parent as Record<string, unknown>)?.database_id as string;
  if (databaseId !== process.env.NOTION_THOUGHTS_DB_ID) {
    res.status(200).json({ skipped: true });
    return;
  }

  const notion_page_id = body.id as string;
  const properties = body.properties as Record<string, unknown>;

  // Extract content from Notion page properties
  const contentBlocks = (properties?.content as Record<string, unknown>)?.rich_text as Array<Record<string, unknown>>;
  const content = contentBlocks?.map((b: Record<string, unknown>) => (b as Record<string, unknown>)?.plain_text as string).join("") ?? "";

  if (!content.trim()) {
    res.status(200).json({ skipped: true, reason: "empty content" });
    return;
  }

  // Extract model from select property
  const modelOption = ((properties?.model as Record<string, unknown>)?.select as Record<string, unknown>)?.name as string;
  const model = modelOption ?? process.env.DEFAULT_WORKER_MODEL ?? "google/gemini-2.0-flash-lite";

  // Idempotency — skip if already inserted
  const existing = await getThoughtByNotionId(notion_page_id);
  if (existing) {
    res.status(200).json({ skipped: true, reason: "already processed" });
    return;
  }

  const thought = await insertThought({ notion_page_id, content, model });

  // Respond immediately, then fire classify asynchronously
  res.status(202).json({ thought_id: thought.id });

  handleClassify({
    thought_id: thought.id,
    notion_page_id,
    content,
    model,
  }).catch(err => {
    console.error(`classify failed for thought ${thought.id}:`, err);
  });
}
