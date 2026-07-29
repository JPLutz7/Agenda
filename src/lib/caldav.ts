import "server-only";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { decryptSecret } from "./secrets";

/** createDAVClient returns a bag of bound functions, not the DAVClient class. */
type DavClient = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Two-way sync with iCloud over CalDAV.
 *
 * The published .ics feeds this app started with are read-only by design —
 * Apple gives no way to write back through them. CalDAV is the actual
 * protocol the Calendar app itself speaks, so events created here land in
 * iCloud and show up on both phones like any other event.
 *
 * The trade is credentials: this needs an Apple ID and an app-specific
 * password (appleid.apple.com → Sign-In and Security → App-Specific
 * Passwords). Apple's 2FA means a normal password will not work. The password
 * is encrypted at rest — see lib/secrets.ts — and can be revoked from that
 * same Apple page at any time without touching the account itself.
 */

/**
 * iCloud's CalDAV entry point. Overridable so this also works against
 * Fastmail, a self-hosted server, or a test one — the protocol is the same,
 * only the discovery URL differs.
 */
export const ICLOUD_CALDAV_URL =
  process.env.AGENDA_CALDAV_URL ?? "https://caldav.icloud.com";

export type StoredAccount = {
  id: number;
  server_url: string;
  username: string;
  password_enc: string;
};

export type DiscoveredCalendar = {
  url: string;
  displayName: string;
  /** Calendars that can't hold events (reminder lists) are not useful here. */
  supportsEvents: boolean;
  readOnly: boolean;
};

async function connect(
  serverUrl: string,
  username: string,
  password: string,
): Promise<DavClient> {
  return createDAVClient({
    serverUrl,
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

export async function clientForAccount(
  account: StoredAccount,
): Promise<DavClient> {
  return connect(
    account.server_url,
    account.username,
    decryptSecret(account.password_enc),
  );
}

function describeAuthFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|unauthor/i.test(message)) {
    return (
      "Apple rejected those credentials. Use an app-specific password from " +
      "appleid.apple.com — your normal Apple ID password won't work with " +
      "two-factor authentication turned on."
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(message)) {
    return "Couldn't reach the calendar server.";
  }
  return message;
}

function toDiscovered(calendar: DAVCalendar): DiscoveredCalendar {
  const components = (calendar.components ?? []) as string[];
  // tsdav doesn't surface the DAV privilege set, so there's no reliable way
  // to tell an editable calendar from a subscription up front. Rather than
  // guess and risk hiding the calendar someone actually wants to write to,
  // offer them all: a write to a read-only calendar fails with the server's
  // own reason, which is surfaced in the UI.
  const privileges = (calendar as unknown as { privilegeSet?: unknown[] })
    .privilegeSet;
  const reportedReadOnly =
    Array.isArray(privileges) &&
    privileges.length > 0 &&
    !/"write(-content)?"/.test(JSON.stringify(privileges));

  return {
    url: calendar.url,
    displayName:
      typeof calendar.displayName === "string" && calendar.displayName.trim()
        ? calendar.displayName
        : "Untitled calendar",
    supportsEvents: components.length === 0 || components.includes("VEVENT"),
    readOnly: reportedReadOnly,
  };
}

async function listCalendars(
  client: DavClient,
): Promise<DiscoveredCalendar[]> {
  const calendars = await client.fetchCalendars();
  return calendars.map(toDiscovered).filter((c) => c.supportsEvents);
}

/** Verify credentials and list what's on the account. */
export async function discoverCalendars(
  serverUrl: string,
  username: string,
  password: string,
): Promise<DiscoveredCalendar[]> {
  try {
    return await listCalendars(await connect(serverUrl, username, password));
  } catch (err) {
    throw new Error(describeAuthFailure(err));
  }
}

/**
 * The same lookup for an account already connected, so calendars made in
 * iCloud after connecting can still be found.
 */
export async function discoverCalendarsForAccount(
  account: StoredAccount,
): Promise<DiscoveredCalendar[]> {
  try {
    return await listCalendars(await clientForAccount(account));
  } catch (err) {
    throw new Error(describeAuthFailure(err));
  }
}

/** Every .ics document in a calendar, for the reader to expand. */
export async function fetchCalendarDocuments(
  account: StoredAccount,
  calendarUrl: string,
): Promise<string[]> {
  try {
    const client = await clientForAccount(account);
    const calendars = await client.fetchCalendars();
    const calendar = calendars.find((c) => c.url === calendarUrl);
    if (!calendar) {
      throw new Error(
        "That calendar is no longer on the account. It may have been " +
          "deleted or renamed in iCloud.",
      );
    }
    const objects = await client.fetchCalendarObjects({ calendar });
    return objects
      .map((o) => o.data)
      .filter((d): d is string => typeof d === "string" && d.length > 0);
  } catch (err) {
    throw new Error(describeAuthFailure(err));
  }
}

/* ------------------------------------------------------------ writing back */

/** RFC 5545 escaping for text values. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Content lines are limited to 75 octets; longer ones continue on the next
 * line prefixed with a space. Folding by character would corrupt multi-byte
 * ones, so this counts UTF-8 bytes.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split inside a multi-byte character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // subsequent lines carry a leading space
  }
  return parts.join("\r\n ");
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type OutgoingEvent = {
  uid: string;
  summary: string;
  notes: string | null;
  /** all-day: 'YYYY-MM-DD'; timed: ISO UTC. Matches lib/dates.ts. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

export function buildICalendar(event: OutgoingEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agenda//Shared apartment calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
  ];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${event.startsAt.replace(/-/g, "")}`);
    // DTEND is exclusive for all-day events; endsAt already holds that.
    lines.push(`DTEND;VALUE=DATE:${event.endsAt.replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART:${utcStamp(new Date(event.startsAt))}`);
    lines.push(`DTEND:${utcStamp(new Date(event.endsAt))}`);
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export type WriteResult = { url: string; etag: string | null };

export async function createRemoteEvent(
  account: StoredAccount,
  calendarUrl: string,
  event: OutgoingEvent,
): Promise<WriteResult> {
  const client = await clientForAccount(account);
  const calendars = await client.fetchCalendars();
  const calendar = calendars.find((c) => c.url === calendarUrl);
  if (!calendar) throw new Error("That calendar is no longer on the account.");

  const filename = `${event.uid}.ics`;
  const response = await client.createCalendarObject({
    calendar,
    filename,
    iCalString: buildICalendar(event),
  });

  if (!response.ok) {
    throw new Error(
      `iCloud rejected the event (${response.status} ${response.statusText}).`,
    );
  }

  // Some servers return the etag on create, others don't. The object URL is
  // deterministic from the filename, so derive it rather than depending on a
  // Location header.
  const url = new URL(filename, calendarUrl).toString();
  return { url, etag: response.headers?.get?.("etag") ?? null };
}

/**
 * Rewrite an event already in iCloud, in place.
 *
 * The UID and the object URL both stay as they were, which is what makes this
 * an edit rather than a new event: iCloud matches on UID, so changing it would
 * leave the old one sitting in the calendar and add a second copy beside it.
 */
export async function updateRemoteEvent(
  account: StoredAccount,
  objectUrl: string,
  etag: string | null,
  event: OutgoingEvent,
): Promise<WriteResult> {
  const client = await clientForAccount(account);
  const response = await client.updateCalendarObject({
    calendarObject: {
      url: objectUrl,
      // No etag means no If-Match, so the write goes through regardless of
      // what's there. We only get here for events this app created and owns.
      etag: etag ?? "",
      data: buildICalendar(event),
    },
  });

  if (!response.ok) {
    throw new Error(
      `iCloud rejected the change (${response.status} ${response.statusText}).`,
    );
  }
  return { url: objectUrl, etag: response.headers?.get?.("etag") ?? null };
}

export async function deleteRemoteEvent(
  account: StoredAccount,
  objectUrl: string,
  etag: string | null,
): Promise<void> {
  const client = await clientForAccount(account);
  const response = await client.deleteCalendarObject({
    calendarObject: { url: objectUrl, etag: etag ?? "", data: "" },
  });
  // A 404 means it's already gone in iCloud, which is the desired end state.
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Couldn't remove it from iCloud (${response.status} ${response.statusText}).`,
    );
  }
}
