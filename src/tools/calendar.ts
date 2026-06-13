export async function read_calendar(args: Record<string, unknown>) {
  const { date } = args as { date: string };
  console.log("[calendar] read_calendar for date:", date);
  // TODO(Railway): replace with actual Google Calendar MCP call
  // mcp__google_calendar__list_events({ date })
  return { date, events: [] };
}
