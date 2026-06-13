import type { ToolSchema } from "../worker/interface";

export interface ToolDefinition {
  schema: ToolSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  policy: "allow" | "blocked" | "conditional";
  availableIn: Array<"classify" | "digest" | "recovery" | "manual">;
}

// Executors are registered in src/tools/ and wired here at server start
// to avoid circular imports. This file exports only schemas.

export const TOOL_SCHEMAS: Record<string, ToolSchema> = {
  search_thoughts: {
    name: "search_thoughts",
    description: "Search Supabase thoughts by text content. Returns matching thought records.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
  search_tasks: {
    name: "search_tasks",
    description: "Search Supabase tasks by title/description. Returns matching task records.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
  write_task: {
    name: "write_task",
    description: "Create a new task in Supabase and Notion Tasks database.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["task", "question", "idea", "concern", "note"] },
        urgency: { type: "number", description: "Integer 1-10" },
        importance: { type: "number", description: "Integer 1-10" },
        confidence: { type: "number", description: "Classification confidence 0-1" },
        want_done_at: { type: "string", description: "ISO date string (optional)" },
        need_done_at: { type: "string", description: "ISO date string (optional)" },
        thought_id: { type: "string", description: "Supabase thought ID to link" },
      },
      required: ["title", "type", "urgency", "importance", "confidence", "thought_id"],
    },
  },
  update_task: {
    name: "update_task",
    description: "Update fields on an existing task. Do not include fields you are not changing.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        fields: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            type: { type: "string" },
            urgency: { type: "number" },
            importance: { type: "number" },
            want_done_at: { type: "string" },
            need_done_at: { type: "string" },
          },
        },
        current: {
          type: "object",
          description: "Current field values (required for urgency/importance to evaluate approval policy)",
          properties: {
            urgency: { type: "number" },
            importance: { type: "number" },
          },
        },
      },
      required: ["task_id", "fields"],
    },
  },
  update_thought_status: {
    name: "update_thought_status",
    description: "Mark a thought as processed or failed in Supabase.",
    parameters: {
      type: "object",
      properties: {
        thought_id: { type: "string" },
        status: { type: "string", enum: ["processing", "completed", "failed"] },
      },
      required: ["thought_id", "status"],
    },
  },
  write_alert: {
    name: "write_alert",
    description: "Write an alert to Supabase and Notion Alerts database.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["error", "approval_request", "change_notification"] },
        title: { type: "string" },
        payload: { type: "object" },
      },
      required: ["type", "title", "payload"],
    },
  },
  read_calendar: {
    name: "read_calendar",
    description: "Read Google Calendar events for a given date. Used in digest to understand the day.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date string (YYYY-MM-DD)" },
      },
      required: ["date"],
    },
  },
  write_digest_page: {
    name: "write_digest_page",
    description: "Write the nightly digest as a Notion page under the Digests parent.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        content: { type: "string", description: "Full markdown content of the digest" },
        covered_task_ids: {
          type: "array",
          items: { type: "string" },
          description: "Supabase task IDs referenced in this digest",
        },
      },
      required: ["date", "content", "covered_task_ids"],
    },
  },
  delete_thought: {
    name: "delete_thought",
    description: "Delete a thought. (Always returns BLOCKED — do not attempt to use.)",
    parameters: { type: "object", properties: {}, required: [] },
  },
  delete_task: {
    name: "delete_task",
    description: "Delete a task. (Always returns BLOCKED — do not attempt to use.)",
    parameters: { type: "object", properties: {}, required: [] },
  },
  delete_alert: {
    name: "delete_alert",
    description: "Delete an alert. (Always returns BLOCKED — do not attempt to use.)",
    parameters: { type: "object", properties: {}, required: [] },
  },
};
