"use client";

import {
  addDays,
  formatMonthShort,
  isSameMonth,
  monthGridRange,
} from "@/lib/dates";

/**
 * Twelve months at once, as a way of getting somewhere — not of reading
 * events. There's no room to show anything per day at this size, and Google's
 * year view doesn't try either; tapping a month drops you into it.
 */
export function YearGrid({
  year,
  today,
  onPickMonth,
}: {
  /** Any day within the year being shown. */
  year: string;
  today: string;
  onPickMonth: (day: string) => void;
}) {
  const months = Array.from(
    { length: 12 },
    (_, i) => `${year.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`,
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {months.map((month) => {
        const { from, to } = monthGridRange(month);
        const cells: string[] = [];
        for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
        const hasToday = isSameMonth(month, today);

        return (
          <button
            key={month}
            type="button"
            onClick={() => onPickMonth(month)}
            className={`rounded-xl border p-2 text-left transition-colors ${
              hasToday
                ? "border-accent/50 bg-accent/5"
                : "border-border bg-surface hover:border-muted"
            }`}
          >
            <div
              className={`mb-1 px-0.5 text-xs font-semibold ${
                hasToday ? "text-accent" : ""
              }`}
            >
              {formatMonthShort(month)}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {cells.map((day) => {
                const inMonth = isSameMonth(day, month);
                const isToday = day === today;
                return (
                  <span
                    key={day}
                    className={`flex h-3.5 items-center justify-center rounded-full text-[8px] leading-none ${
                      isToday
                        ? "bg-accent font-bold text-white"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted/40"
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
