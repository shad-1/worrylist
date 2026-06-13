import * as dotenv from "dotenv";
dotenv.config();

import { initTracing } from "./observability/index";
const sdk = initTracing(); // Must be first — before any openai imports

import express from "express";
import { handlePageCreated } from "./triggers/webhook-page-created";
import { handlePageUpdated } from "./triggers/webhook-page-updated";
import { handleClassify } from "./triggers/classify";
import { handleDigest } from "./triggers/digest";
import { handleRecovery } from "./triggers/recovery";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Notion webhooks
app.post("/webhook/notion/page-created", handlePageCreated);
app.post("/webhook/notion/page-updated", handlePageUpdated);

// Run handlers (also cron targets)
app.post("/classify", async (req, res) => {
  const { thought_id, notion_page_id, content, model } = req.body;
  if (!thought_id || !content) {
    res.status(400).json({ error: "thought_id and content required" });
    return;
  }
  res.status(202).json({ queued: true });
  handleClassify({ thought_id, notion_page_id, content, model }).catch(console.error);
});

app.post("/digest", async (_req, res) => {
  res.status(202).json({ queued: true });
  handleDigest().catch(console.error);
});

app.post("/recover", async (_req, res) => {
  res.status(202).json({ queued: true });
  handleRecovery().catch(console.error);
});

const port = parseInt(process.env.PORT ?? "3000");
const server = app.listen(port, () => console.log(`Worrylist listening on :${port}`));

process.on("SIGTERM", async () => {
  server.close();
  await sdk.shutdown();
});
