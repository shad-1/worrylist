import { GUARDRAILS, UPDATE_TASK_FIELD_POLICY, urgencyRequiresApproval } from "../config/guardrails";
import type { ActionPolicy } from "../config/guardrails";

export interface ActionGuardrailResult {
  policy: ActionPolicy;
  reason?: string;
}

export function applyActionGuardrail(
  toolName: string,
  args: Record<string, unknown>
): ActionGuardrailResult {
  const basePolicy = GUARDRAILS.actions[toolName];

  if (!basePolicy) {
    return { policy: "blocked", reason: `Tool '${toolName}' is not registered` };
  }

  if (basePolicy === "blocked") {
    return { policy: "blocked", reason: `Tool '${toolName}' is blocked` };
  }

  if (basePolicy === "conditional" && toolName === "update_task") {
    const fields = (args.fields ?? {}) as Record<string, unknown>;
    const current = (args.current ?? {}) as Record<string, unknown>;

    for (const field of Object.keys(fields)) {
      const fieldPolicy = UPDATE_TASK_FIELD_POLICY[field];
      if (fieldPolicy === "blocked") {
        return { policy: "blocked", reason: `Field '${field}' cannot be updated by the agent` };
      }
      if (field === "urgency" || field === "importance") {
        const newVal = fields[field] as number;
        const oldVal = current[field] as number | undefined;
        if (urgencyRequiresApproval(oldVal, newVal)) {
          return { policy: "requires_approval", reason: `${field} change to/from 10 requires approval` };
        }
      }
    }

    return { policy: "allow" };
  }

  return { policy: basePolicy };
}
