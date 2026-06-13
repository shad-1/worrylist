import { google, type calendar_v3 } from "googleapis";

// Lazy singleton: a read-only Google Calendar client authenticated with a
// service account. The service account's email must be granted (shared) read
// access to the target calendar. Constructed on first use so importing this
// module doesn't require Google credentials (keeps tests/imports cheap).
let calendarClient: calendar_v3.Calendar | null = null;

function getCalendar(): calendar_v3.Calendar {
  if (!calendarClient) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be set");
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(raw),
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    calendarClient = google.calendar({ version: "v3", auth });
  }
  return calendarClient;
}

export async function read_calendar(args: Record<string, unknown>) {
  const { date } = args as { date: string };
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";

  // Bound the query to the given calendar day (offsetless ISO; Google treats
  // these as UTC, which is fine for a daily digest window).
  const timeMin = new Date(`${date}T00:00:00.000Z`).toISOString();
  const timeMax = new Date(`${date}T23:59:59.999Z`).toISOString();

  const res = await getCalendar().events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events = (res.data.items ?? []).map((e) => ({
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location ?? null,
  }));

  return { date, events };
}
