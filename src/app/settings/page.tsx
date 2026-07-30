import { requireSignedIn } from "@/lib/guard";
import {
  getCalDavAccounts,
  getFeeds,
  getPeople,
  getWriteCalendar,
  timezone,
} from "@/lib/data";
import { canStoreSecrets } from "@/lib/secrets";
import { getDevices, publicKey } from "@/lib/push";
import { ICloudSetup } from "@/components/icloud-setup";
import { PushSetup } from "@/components/push-setup";
import {
  addFeed,
  addPerson,
  refreshFeeds,
  removeFeed,
  removePerson,
  removePushDevice,
  sendTestNotification,
  setFeedPerson,
  setTimezone,
  signOut,
  updatePersonColor,
} from "@/lib/actions";
import { DEFAULT_TIMEZONE } from "@/lib/dates";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  await requireSignedIn();
  const params = await searchParams;
  const people = getPeople();
  const feeds = getFeeds();
  const tz = timezone();
  const accounts = getCalDavAccounts();
  const writeCalendar = getWriteCalendar();
  const secretsAvailable = canStoreSecrets();
  const devices = getDevices();
  const vapidPublicKey = publicKey();

  return (
    <>
      <PageHeader
        title="Setup"
        subtitle="Calendars, people, and how this thing is wired up."
      />

      {params.welcome && (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
          <p className="font-medium">You&rsquo;re in.</p>
          <p className="mt-1 text-muted">
            Next: publish your iCloud calendars and paste the links below.
          </p>
        </div>
      )}

      <SectionTitle>iCloud (two-way)</SectionTitle>
      <ICloudSetup
        accounts={accounts}
        people={people}
        writeCalendarId={writeCalendar?.id ?? null}
        secretsAvailable={secretsAvailable}
      />

      <SectionTitle>Published links (read-only)</SectionTitle>

      <Card className="mb-3 p-4 text-sm">
        <p className="font-medium">Getting the link out of iCloud</p>
        <p className="mt-2 text-muted">
          An alternative to connecting the account above. Simpler, but it can
          only be read &mdash; nothing you add in this app will reach your real
          calendar this way.
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>
            On a Mac: open Calendar, right-click the calendar, choose{" "}
            <em>Share Calendar</em>. On iPhone: Calendars &rarr; the ⓘ next to
            the calendar.
          </li>
          <li>
            Turn on <em>Public Calendar</em>.
          </li>
          <li>Copy the webcal:// link it gives you and paste it below.</li>
        </ol>
        <p className="mt-3 text-muted">
          Heads up: a published iCloud calendar is readable by anyone who has
          that link. It&rsquo;s a long random URL rather than a password, so
          think about which calendars you publish. This app can only read them
          &mdash; it can&rsquo;t change anything in iCloud.
        </p>
      </Card>

      {feeds.length === 0 ? (
        <Empty>No calendars connected.</Empty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: feed.person_color ?? "#6b7280" }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{feed.label}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {feed.person_name ?? "Apartment"} · {feed.event_count} events
                  {feed.last_synced_at
                    ? ` · synced ${feed.last_synced_at} UTC`
                    : " · never synced"}
                </p>
                {/* Chosen when the link was pasted in, and until now stuck
                    there. A calendar that turns out to be the flat's — a shared
                    "Dorm" — needed deleting and re-adding to say so. */}
                <form
                  action={setFeedPerson.bind(null, feed.id)}
                  className="mt-1.5 flex items-center gap-1.5"
                >
                  <select
                    name="person_id"
                    defaultValue={feed.person_id ?? "household"}
                    aria-label={`Whose calendar ${feed.label} is`}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                  >
                    <option value="household">The apartment</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <SubmitButton variant="quiet" size="sm">
                    Save
                  </SubmitButton>
                </form>
                {feed.last_error && (
                  <p className="mt-1 text-xs text-red-500">{feed.last_error}</p>
                )}
              </div>
              <form action={removeFeed.bind(null, feed.id)}>
                <SubmitButton
                    variant="danger"
                    size="icon"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <form action={refreshFeeds}>
          <SubmitButton variant="quiet">Refresh now</SubmitButton>
        </form>
      </div>

      <div className="mt-3">
        <Disclosure summary="Connect a calendar">
          <ActionForm action={addFeed} className="space-y-3" resetOnSuccess>
            <Field label="Published calendar link">
              <input
                name="url"
                required
                inputMode="url"
                className={fieldClass}
                placeholder="webcal://p01-caldav.icloud.com/published/2/..."
              />
            </Field>
            <Field label="Name it">
              <input
                name="label"
                className={fieldClass}
                placeholder="Joao — Personal"
              />
            </Field>
            <Field label="Whose is it">
              <select name="person_id" className={fieldClass} defaultValue="household">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
                <option value="household">The apartment</option>
              </select>
            </Field>
            <SubmitButton>Connect</SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>

      <SectionTitle>Who lives here</SectionTitle>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-3 px-4 py-3">
            <form
              action={updatePersonColor.bind(null, person.id)}
              className="flex items-center gap-2"
            >
              <input
                type="color"
                name="color"
                defaultValue={person.color}
                aria-label={`Color for ${person.name}`}
                className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
              />
              <SubmitButton variant="danger" className="px-1 py-1 text-xs">
                Save
              </SubmitButton>
            </form>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {person.name}
            </span>
            <form action={removePerson.bind(null, person.id)}>
              <SubmitButton
                    variant="danger"
                    size="icon"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </SubmitButton>
            </form>
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <Disclosure summary="Add someone">
          <ActionForm action={addPerson} className="flex gap-2" resetOnSuccess>
            <input
              name="name"
              required
              className={fieldClass}
              placeholder="Name"
            />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="p-4">
        <PushSetup people={people} vapidPublicKey={vapidPublicKey} />
      </Card>

      {devices.length > 0 && (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center gap-2 px-4 py-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {device.person_name ?? "Unassigned"}
                  {device.label ? ` · ${device.label}` : ""}
                </span>
                <span className="block text-xs text-muted">
                  {device.last_sent_at
                    ? `Last notified ${device.last_sent_at.slice(0, 10)}`
                    : "Nothing sent yet"}
                </span>
                {/* A phone that's registered but being refused looks identical
                    to one that's fine, unless the refusal is shown. It's the
                    difference between "nothing arrived" and knowing why. */}
                {device.last_error && (
                  <span className="mt-0.5 block text-xs text-red-500">
                    Last attempt failed — {device.last_error}
                  </span>
                )}
              </span>
              <form action={removePushDevice.bind(null, device.id)}>
                <SubmitButton
                  variant="danger"
                  size="icon"
                  title="Stop sending to this device"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      {/* Outside the list on purpose. It used to sit inside it, so a test that
          failed because the phone had revoked deleted the only row, took the
          button and its explanation down with it, and left a tap that appeared
          to do nothing. The answer to "did that work?" has to survive the
          answer being no. */}
      <div className="mt-3">
        <ActionForm action={sendTestNotification}>
          <SubmitButton variant="quiet">Send a test</SubmitButton>
        </ActionForm>
      </div>

      <SectionTitle>Timezone</SectionTitle>
      <Card className="p-4">
        <ActionForm action={setTimezone} className="flex gap-2">
          <input
            name="timezone"
            defaultValue={tz}
            className={fieldClass}
            placeholder={DEFAULT_TIMEZONE}
          />
          <SubmitButton variant="quiet">Save</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">
          An IANA name like America/New_York or Europe/Lisbon. Every day and
          due date in the app is worked out in this zone.
        </p>
      </Card>

      <SectionTitle>Session</SectionTitle>
      <form action={signOut} className="mb-4">
        <SubmitButton variant="quiet">Sign out</SubmitButton>
      </form>
    </>
  );
}
