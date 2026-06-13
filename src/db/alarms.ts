import { db } from "./client";
import type { Alarm } from "../config/alarms";

export async function insertAlarm(alarm: Alarm): Promise<void> {
  const { error } = await db.from("alarm_log").insert({
    run_id: alarm.run_id,
    type: alarm.type,
    severity: alarm.severity,
    context: alarm.context,
    recommended_action: alarm.recommended_action,
  });
  if (error) throw new Error(`insertAlarm: ${error.message}`);
}
