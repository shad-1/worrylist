import * as dotenv from "dotenv";
dotenv.config();

// Run this with: npx ts-node src/notion/setup.ts
// Uses Notion MCP tools (available in Claude Code session)
// Outputs DB IDs to paste into .env

async function setup() {
  console.log("Worrylist Notion Setup");
  console.log("======================");
  console.log("Run the following MCP calls in order via Claude Code:\n");

  console.log(`
1. Create parent page titled "Worrylist" under your workspace root.
   MCP call: mcp__notion__create_page
   parent: { workspace: true }
   title: "Worrylist"
   → save returned page ID as NOTION_PARENT_PAGE_ID

2. Create Thoughts database under the parent page.
   MCP call: mcp__notion__create_database
   parent: { page_id: NOTION_PARENT_PAGE_ID }
   title: "Thoughts"
   properties:
     content: { rich_text: {} }
     status: { select: { options: [
       { name: "unprocessed", color: "gray" },
       { name: "processing", color: "yellow" },
       { name: "processed", color: "green" },
       { name: "failed", color: "red" }
     ]}}
     model: { select: { options: [
       { name: "google/gemini-2.0-flash-lite", color: "blue" },
       { name: "anthropic/claude-sonnet-4-6", color: "purple" },
       { name: "google/gemini-2.5-flash", color: "green" }
     ]}}
     run_id: { rich_text: {} }
     created_at: { date: {} }
   → save returned DB ID as NOTION_THOUGHTS_DB_ID

3. Create Tasks database under the parent page.
   MCP call: mcp__notion__create_database
   parent: { page_id: NOTION_PARENT_PAGE_ID }
   title: "Tasks"
   properties:
     title: { title: {} }
     description: { rich_text: {} }
     type: { select: { options: [
       { name: "task" }, { name: "question" },
       { name: "idea" }, { name: "concern" }, { name: "note" }
     ]}}
     urgency: { number: { format: "number" } }
     importance: { number: { format: "number" } }
     want_done_at: { date: {} }
     need_done_at: { date: {} }
     status: { select: { options: [
       { name: "pending", color: "gray" },
       { name: "scheduled", color: "blue" },
       { name: "done", color: "green" },
       { name: "cancelled", color: "red" }
     ]}}
     thought_ids: { rich_text: {} }
   → save returned DB ID as NOTION_TASKS_DB_ID

4. Create Alerts database under the parent page.
   MCP call: mcp__notion__create_database
   parent: { page_id: NOTION_PARENT_PAGE_ID }
   title: "Alerts"
   properties:
     title: { title: {} }
     type: { select: { options: [
       { name: "error", color: "red" },
       { name: "approval_request", color: "orange" },
       { name: "change_notification", color: "blue" }
     ]}}
     status: { select: { options: [
       { name: "pending", color: "gray" },
       { name: "acknowledged", color: "blue" },
       { name: "approved", color: "green" },
       { name: "rejected", color: "red" }
     ]}}
     payload: { rich_text: {} }
     run_id: { rich_text: {} }
     created_at: { date: {} }
   → save returned DB ID as NOTION_ALERTS_DB_ID

5. Digests lives as a regular page (not a database) — agent creates
   one child page per night. No setup required beyond the parent page.
   Create a child page titled "Digests" under NOTION_PARENT_PAGE_ID.
   → save returned page ID as NOTION_DIGESTS_PAGE_ID (add to .env)
  `);
}

setup();
