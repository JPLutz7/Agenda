import * as ical from "node-ical";
import type { DayKey } from "./dates";

/**
 * Reading iCloud's published calendar feeds.
 *
 * iCloud gives you a `webcal://p##-caldav.icloud.com/published/2/...` URL when
 * you make a calendar public. It's a plain read-only .ics document — no auth,
 * no API. We fetch it, expand any recurring events across the window we care
 * about, and hand back flat occurrences.
 */

export type ParsedOccurrence = {
  uid: string;
  summary: string;
  location: string | null;
  /** all-day → 'YYYY-MM-DD'; timed → ISO UTC. See lib/dates.ts. */
  startsAt: string;
  /** For all-day this is the *exclusive* end day, matching the iCal spec. */
  endsAt: string;
  allDay: boolean;
};

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** iCloud hands out webcal:// links; that's just http(s) with a costume on. */
export function normalizeFeedUrl(raw: string): string {
  const url = raw.trim();
  if (/^webcal:\/\//i.test(url)) return url.replace(/^webcal:\/\//i, "https://");
  return url;
}

export async function fetchIcs(rawUrl: string): Promise<string> {
  const url = normalizeFeedUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Feed URL must start with webcal://, https:// or http://");
  }

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Calendar server returned ${res.status}. If you un-published this ` +
        `calendar in iCloud the link stops working — re-publish and paste ` +
        `the new one.`,
    );
  }

  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new Error("That calendar is unusually large; refusing to import it.");
  }
  if (!body.includes("BEGIN:VCALENDAR")) {
    throw new Error(
      "That URL didn't return a calendar. Make sure you copied the " +
        "published link and not the page you found it on.",
    );
  }
  return body;
}

/**
 * node-ical parses VALUE=DATE properties to midnight, but whether that's UTC
 * midnight or the server's local midnight has varied across versions. Read
 * whichever interpretation actually lands on midnight so an all-day event
 * can't slip a day depending on where this is deployed.
 */
function dateOnlyKey(d: Date): DayKey {
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return d.toISOString().slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isAllDay(event: ical.VEvent): boolean {
  return (
    event.datetype === "date" ||
    (event.start as Date & { dateOnly?: boolean })?.dateOnly === true
  );
}

function shiftDayKey(day: DayKey, days: number): DayKey {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * EXDATE entries get keyed by node-ical under both a bare date and a full
 * ISO string, so check both spellings before deciding an occurrence survived.
 */
function isExcluded(event: ical.VEvent, occurrence: Date): boolean {
  const exdate = (event as unknown as { exdate?: Record<string, Date> }).exdate;
  if (!exdate) return false;
  const iso = occurrence.toISOString();
  return (
    iso in exdate ||
    iso.slice(0, 10) in exdate ||
    occurrence.toISOString().replace(/\.\d{3}Z$/, "Z") in exdate
  );
}

function overrideFor(
  event: ical.VEvent,
  occurrence: Date,
): ical.VEvent | undefined {
  const recurrences = (event as unknown as {
    recurrences?: Record<string, ical.VEvent>;
  }).recurrences;
  if (!recurrences) return undefined;
  const iso = occurrence.toISOString();
  return recurrences[iso] ?? recurrences[iso.slice(0, 10)];
}

function buildOccurrence(
  event: ical.VEvent,
  start: Date,
  durationMs: number,
): ParsedOccurrence {
  const allDay = isAllDay(event);
  const summary = (event.summary ?? "").toString().trim() || "(no title)";
  const location = (event.location ?? "").toString().trim() || null;

  if (allDay) {
    const startKey = dateOnlyKey(start);
    // iCal all-day DTEND is exclusive; a one-day event ends the next morning.
    const spanDays = Math.max(1, Math.round(durationMs / 86_400_000));
    return {
      uid: String(event.uid ?? ""),
      summary,
      location,
      startsAt: startKey,
      endsAt: shiftDayKey(startKey, spanDays),
      allDay: true,
    };
  }

  return {
    uid: String(event.uid ?? ""),
    summary,
    location,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + durationMs).toISOString(),
    allDay: false,
  };
}

/**
 * Flatten a calendar document into individual occurrences between two
 * instants. Recurring events are expanded; cancelled ones are dropped.
 */
export function expandIcs(
  body: string,
  windowStart: Date,
  windowEnd: Date,
): ParsedOccurrence[] {
  const parsed = ical.parseICS(body);
  const out: ParsedOccurrence[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const event = component as ical.VEvent;
    if (String(event.status ?? "").toUpperCase() === "CANCELLED") continue;
    if (!event.start) continue;

    const start = event.start as Date;
    const end = (event.end as Date | undefined) ?? start;
    // A zero-length all-day event still occupies its day.
    const durationMs = Math.max(
      end.getTime() - start.getTime(),
      isAllDay(event) ? 86_400_000 : 0,
    );

    const rrule = (event as unknown as { rrule?: { between: (a: Date, b: Date, inc: boolean) => Date[] } }).rrule;

    if (!rrule) {
      const occurrenceEnd = new Date(start.getTime() + durationMs);
      if (occurrenceEnd >= windowStart && start <= windowEnd) {
        out.push(buildOccurrence(event, start, durationMs));
      }
      continue;
    }

    // Widen the query by the event's own length so a long event that started
    // before the window but is still running today doesn't get missed.
    const queryStart = new Date(windowStart.getTime() - durationMs);
    let occurrences: Date[];
    try {
      occurrences = rrule.between(queryStart, windowEnd, true);
    } catch {
      // A malformed RRULE shouldn't take the whole calendar down with it.
      continue;
    }

    for (const occurrence of occurrences) {
      if (isExcluded(event, occurrence)) continue;

      const override = overrideFor(event, occurrence);
      if (override) {
        if (String(override.status ?? "").toUpperCase() === "CANCELLED") continue;
        const oStart = override.start as Date;
        const oEnd = (override.end as Date | undefined) ?? oStart;
        out.push(
          buildOccurrence(
            override,
            oStart,
            Math.max(
              oEnd.getTime() - oStart.getTime(),
              isAllDay(override) ? 86_400_000 : 0,
            ),
          ),
        );
        continue;
      }

      out.push(buildOccurrence(event, occurrence, durationMs));
    }
  }

  return out;
}
