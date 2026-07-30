// Explicit .ts: tests import this module directly under Node's own resolver,
// which doesn't guess extensions the way the bundler does.
import { formatTime } from "./dates.ts";

/**
 * The one line at the top of Today that answers the question before you read
 * anything.
 *
 * Every screen in this app was a list, and a list makes you do the work: read
 * six rows, compare six times against the clock in your status bar, and decide
 * what that means. The thing you actually opened the app to find out is "what's
 * happening and when" — so say it, in words, in large type, and let the list
 * underneath be the detail rather than the answer.
 *
 * Kept pure and away from the database so it can be tested directly; the phrasing
 * is the part worth pinning, and it has more edge cases than it looks (an event
 * running right now beats one starting soon, an all-day thing has no "in 40
 * minutes", and "in 1 hours" is the kind of thing that ships).
 */

/** The shape this needs from an event. `AgendaEvent` satisfies it. */
export type HeadlineEvent = {
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string;
};

export type HeadlineChore = {
  title: string;
  overdue: boolean;
};

export type Headline = {
  /** Which case this is, for styling and for tests. */
  kind: "now" | "next" | "allday" | "chores" | "clear";
  /** The small word above: NOW, NEXT, TODAY. */
  label: string;
  /** The big line. */
  title: string;
  /** The small line under it. Empty when there's nothing to add. */
  detail: string;
  /** Whose it is, for the tint. Null leaves it untinted. */
  color: string | null;
};

/**
 * "in 40 minutes", "in 2 hours", "in 1 hour 20 min".
 *
 * Not a duration formatter — deliberately vaguer as it gets further away,
 * because "in 6 hours 12 minutes" is a precision nobody asked for and reads as
 * noise. Under an hour is where the exact number actually changes behaviour.
 */
export function relativeTime(minutes: number): string {
  if (minutes < 1) return "in a moment";
  if (minutes === 1) return "in a minute";
  if (minutes < 60) return `in ${minutes} minutes`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourWord = hours === 1 ? "hour" : "hours";
  if (rest === 0 || hours >= 4) return `in ${hours} ${hourWord}`;
  return `in ${hours} ${hourWord} ${rest} min`;
}

const minutesBetween = (fromIso: string, toIso: string) =>
  Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000,
  );

/**
 * How long until a thing, as a number and a word — "23" / "minutes".
 *
 * Split in two because they're set at different sizes: the figure is the
 * largest thing in its row and the unit is a caption under it. That's Flighty's
 * arrangement, and the reason it works is that a clock time makes you do
 * arithmetic against the clock in your status bar, while "23 minutes" is
 * already the answer.
 *
 * Null means there's nothing useful to count down to: it's over, it's an
 * all-day thing, or it's far enough away that the hour it starts is the more
 * meaningful fact.
 */
export type Countdown = { value: string; unit: string };

/** Past this, a clock time says more than a count of hours does. */
const COUNTDOWN_HORIZON_MINUTES = 12 * 60;

export function countdownTo(
  startsAt: string,
  endsAt: string,
  nowIso: string,
): Countdown | null {
  if (endsAt <= nowIso) return null;
  if (startsAt <= nowIso) return { value: "Now", unit: "" };

  const minutes = minutesBetween(nowIso, startsAt);
  if (minutes > COUNTDOWN_HORIZON_MINUTES) return null;
  // Rounds down, so "1 hour" never appears while it's still 1 hour 59 away.
  if (minutes < 60) {
    return { value: String(minutes), unit: minutes === 1 ? "minute" : "minutes" };
  }
  const hours = Math.floor(minutes / 60);
  return { value: String(hours), unit: hours === 1 ? "hour" : "hours" };
}

export function buildHeadline({
  events,
  chores,
  nowIso,
  timeZone,
  dormColor,
}: {
  /** Today's events, in the order the day lists them. */
  events: HeadlineEvent[];
  /** Chores due or overdue today. */
  chores: HeadlineChore[];
  nowIso: string;
  timeZone: string;
  /** The colour to use when the answer isn't about one particular event. */
  dormColor: string;
}): Headline {
  const timed = events.filter((e) => !e.allDay);

  // Something already underway wins. Being told what's next while you're in the
  // middle of something else is the wrong answer to the right question.
  const underway = timed.find(
    (e) => e.startsAt <= nowIso && e.endsAt > nowIso,
  );
  if (underway) {
    return {
      kind: "now",
      label: "Now",
      title: underway.summary,
      detail: `until ${formatTime(underway.endsAt, timeZone)}`,
      color: underway.color,
    };
  }

  const next = timed.find((e) => e.startsAt > nowIso);
  if (next) {
    return {
      kind: "next",
      label: "Next",
      title: next.summary,
      // The clock time, not "in 40 minutes". The row for this event counts
      // itself down; saying it twice on one screen just invites you to check
      // whether the two agree.
      detail: formatTime(next.startsAt, timeZone),
      color: next.color,
    };
  }

  // No clock time left today, but an all-day entry is still worth leading with —
  // it's the whole day's news.
  const allDay = events.filter((e) => e.allDay);
  if (allDay.length > 0) {
    return {
      kind: "allday",
      label: "Today",
      title: allDay[0].summary,
      detail:
        allDay.length > 1
          ? `and ${allDay.length - 1} other${allDay.length === 2 ? "" : "s"}`
          : "",
      color: allDay[0].color,
    };
  }

  if (chores.length > 0) {
    const overdue = chores.filter((c) => c.overdue).length;
    return {
      kind: "chores",
      label: "Today",
      title:
        chores.length === 1
          ? chores[0].title
          : `${chores.length} chores to do`,
      detail: overdue > 0 ? `${overdue} of them overdue` : "",
      color: dormColor,
    };
  }

  return {
    kind: "clear",
    label: "Today",
    title: "Nothing left today",
    detail: "",
    color: null,
  };
}
