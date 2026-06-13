import { updateThoughtStatus } from "../db/thoughts";

export async function update_thought_status(args: Record<string, unknown>) {
  const { thought_id, status } = args as { thought_id: string; status: "processing" | "completed" | "failed" };
  await updateThoughtStatus(thought_id, status);
  return { thought_id, status };
}
