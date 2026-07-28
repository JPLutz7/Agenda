/**
 * One event, prepared for display.
 *
 * Every label is worked out on the server, where the household timezone
 * lives. The calendar components do no date arithmetic — they position
 * things using the minute offsets and print the strings they're handed.
 */
export type CalEvent = {
  key: string;
  /** Local day this event belongs to, 'YYYY-MM-DD'. */
  day: string;
  summary: string;
  color: string;
  personName: string | null;
  location: string | null;
  allDay: boolean;
  /** Minutes from local midnight, for grid positioning. */
  startMinutes: number;
  endMinutes: number;
  /** '7 PM' or 'All day'. */
  timeLabel: string;
  /** '7p' — for chips too narrow for the full time. */
  compactTimeLabel: string;
  /** '7 PM – 8:30 PM' or 'All day'. */
  rangeLabel: string;
  /** 'Tuesday, July 28, 2026'. */
  dateLabel: string;
  source: "feed" | "household" | "chore";
  /** Set only for events this app created, which it can also delete. */
  householdId: number | null;
};

export type CalDay = {
  day: string;
  weekdayInitial: string;
  weekdayShort: string;
  dayOfMonth: string;
  isToday: boolean;
  /** False for the leading/trailing days of a month grid. */
  inFocus: boolean;
  events: CalEvent[];
};

export type CalendarScale = "day" | "week" | "month" | "year";

export const SCALES: CalendarScale[] = ["day", "week", "month", "year"];
