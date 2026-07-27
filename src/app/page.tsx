import Link from "next/link";
import { requireSignedIn } from "@/lib/guard";
import { getDashboard } from "@/lib/data";
import { refreshIfStale } from "@/lib/sync";
import { addDays, formatDayLabel } from "@/lib/dates";
import { DaySection } from "@/components/event-list";
import { AddHouseholdEventForm } from "@/components/add-event-form";
import { CompleteChoreButton } from "@/components/chore-controls";
import { PageHeader, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireSignedIn();
  // Kick off a background pull if iCloud hasn't been checked lately. Not
  // awaited — a slow feed shouldn't hold up the page.
  refreshIfStale();

  const { days, chores, people, feeds, timezone, today } = getDashboard();
  const dueNow = chores.filter((c) => c.overdue || c.dueToday);
  const brokenFeeds = feeds.filter((f) => f.last_error);

  // Today and tomorrow always show, even when empty — "nothing on" is useful
  // information. Beyond that, only days that actually have something.
  const visibleDays = days.filter(
    (d, i) => i < 2 || d.events.length > 0,
  );

  return (
    <>
      <PageHeader
        title={formatDayLabel(today, timezone)}
        subtitle={new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC",
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(new Date(`${today}T00:00:00Z`))}
      />

      {feeds.length === 0 && (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
          <p className="font-medium">No calendars connected yet.</p>
          <p className="mt-1 text-muted">
            Publish your iCloud calendars and paste the links in{" "}
            <Link href="/settings" className="text-accent underline">
              Setup
            </Link>
            .
          </p>
        </div>
      )}

      {brokenFeeds.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-medium">
            {brokenFeeds.length === 1
              ? `"${brokenFeeds[0].label}" didn't load.`
              : `${brokenFeeds.length} calendars didn't load.`}
          </p>
          <Link href="/settings" className="mt-1 inline-block text-accent underline">
            See why
          </Link>
        </div>
      )}

      {dueNow.length > 0 && (
        <>
          <SectionTitle>Needs doing</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {dueNow.map((chore) => (
              <li
                key={chore.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{chore.title}</p>
                  <p className="mt-0.5 text-xs">
                    <span className={chore.overdue ? "text-red-500" : "text-muted"}>
                      {chore.dueLabel}
                    </span>
                    {chore.assignee && (
                      <span className="text-muted"> · {chore.assignee.name}</span>
                    )}
                  </p>
                </div>
                <CompleteChoreButton choreId={chore.id} />
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Coming up</SectionTitle>
      {visibleDays.map(({ day, events }) => (
        <DaySection key={day} day={day} events={events} timeZone={timezone} />
      ))}
      {visibleDays.length <= 2 &&
        visibleDays.every((d) => d.events.length === 0) && (
          <p className="px-1 pb-2 text-sm text-muted">
            Nothing else through {formatDayLabel(addDays(today, 13), timezone)}.
          </p>
        )}

      <div className="mt-6">
        <AddHouseholdEventForm people={people} defaultDate={today} />
      </div>
    </>
  );
}
