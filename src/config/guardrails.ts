export type ActionPolicy = "allow" | "blocked" | "conditional" | "requires_approval";

export interface GuardrailsConfig {
  input: {
    max_content_length: number;
    strip_prompt_injection: boolean;
    blocked_patterns: RegExp[];
  };
  actions: Record<string, ActionPolicy>;
  loop: {
    max_turns: number;
    max_tokens_total: number;
    max_wall_time_ms: number;
  };
  output: {
    require_schema: boolean;
    max_length: number;
  };
}

export const GUARDRAILS: GuardrailsConfig = {
  input: {
    max_content_length: 5000,
    strip_prompt_injection: true,
    blocked_patterns: [/ignore previous instructions/i, /disregard.*system/i],
  },
  actions: {
    search_thoughts: "allow",
    search_tasks: "allow",
    read_calendar: "allow",
    write_task: "allow",
    update_task: "conditional",
    update_thought_status: "allow",
    write_alert: "allow",
    write_digest_page: "allow",
    delete_thought: "blocked",
    delete_task: "blocked",
    delete_alert: "blocked",
  },
  loop: {
    max_turns: 10,
    max_tokens_total: 100_000,
    max_wall_time_ms: 60_000,
  },
  output: {
    require_schema: true,
    max_length: 8000,
  },
} as const;

// update_task field-level policies
export const UPDATE_TASK_FIELD_POLICY: Record<string, ActionPolicy> = {
  title: "allow",
  description: "allow",
  type: "allow",
  want_done_at: "allow",
  need_done_at: "allow",
  status: "blocked", // user-initiated only
  urgency: "conditional",    // requires_approval if to/from 10
  importance: "conditional", // requires_approval if to/from 10
};

export function urgencyRequiresApproval(oldVal: number | undefined, newVal: number): boolean {
  return newVal === 10 || (oldVal !== undefined && oldVal === 10);
}
