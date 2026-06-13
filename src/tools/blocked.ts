export const BLOCKED_RESULT = {
  error: "BLOCKED",
  message: "This action is not permitted. The agent cannot delete records.",
} as const;

export async function delete_thought(_args: Record<string, unknown>) {
  return BLOCKED_RESULT;
}

export async function delete_task(_args: Record<string, unknown>) {
  return BLOCKED_RESULT;
}

export async function delete_alert(_args: Record<string, unknown>) {
  return BLOCKED_RESULT;
}
