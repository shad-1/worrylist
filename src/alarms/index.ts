import { insertAlarm } from "../db/alarms";
import { ALARM_CATALOG, type Alarm, type AlarmType } from "../config/alarms";

export async function fireAlarm(
  type: AlarmType,
  run_id: string,
  context: Record<string, unknown>
): Promise<void> {
  const catalog = ALARM_CATALOG[type];
  const alarm: Alarm = {
    type,
    severity: catalog.severity,
    context,
    recommended_action: catalog.recommended_action,
    run_id,
  };
  await insertAlarm(alarm);
  console.error(`[ALARM:${alarm.severity.toUpperCase()}] ${type}`, context);
}
