import { Client } from "@notionhq/client";

// Lazy singleton: constructed on first use, not at import time, so modules that
// import Notion tools (and the test suite) don't fail when NOTION_API_KEY is unset.
let client: Client | null = null;

export function getNotion(): Client {
  if (!client) {
    const auth = process.env.NOTION_API_KEY;
    if (!auth) throw new Error("NOTION_API_KEY must be set");
    client = new Client({ auth });
  }
  return client;
}

// Notion rich_text fields cap at 2000 chars per text object.
export function richText(content: string): Array<{ text: { content: string } }> {
  return [{ text: { content: (content ?? "").slice(0, 2000) } }];
}
