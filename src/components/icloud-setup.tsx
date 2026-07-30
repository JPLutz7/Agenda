import {
  connectICloudAccount,
  disconnectICloudAccount,
  setAccountPerson,
  setCalendarEnabled,
  setCalendarPerson,
  setWriteCalendar,
} from "@/lib/actions";
import type { CalDavAccountView, Person } from "@/lib/data";
import { HOUSEHOLD_COLOR } from "@/lib/colors";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";
import { Card, Empty } from "@/components/ui";
import { Trash2 } from "lucide-react";

export function ICloudSetup({
  accounts,
  people,
  writeCalendarId,
  secretsAvailable,
}: {
  accounts: CalDavAccountView[];
  people: Person[];
  writeCalendarId: number | null;
  secretsAvailable: boolean;
}) {
  const writable = accounts.flatMap((a) =>
    a.calendars.filter((c) => !c.read_only),
  );

  return (
    <>
      <Card className="mb-3 p-4 text-sm">
        <p className="font-medium">Connecting iCloud properly</p>
        <p className="mt-2 text-muted">
          This is the two-way connection: events you add here get written into
          your real iCloud calendar, so they show up in the Calendar app on both
          your phones like anything else. Published links can only be read.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
          <li>
            Go to <strong>appleid.apple.com</strong> &rarr; Sign-In and Security
            &rarr; <em>App-Specific Passwords</em>.
          </li>
          <li>
            Generate one, name it &ldquo;Agenda&rdquo;, and copy it. Your normal
            Apple ID password will not work while two-factor is on.
          </li>
          <li>Paste it below with your Apple ID.</li>
        </ol>
        <p className="mt-3 text-muted">
          The password is encrypted before it&rsquo;s stored and never shown
          again. You can revoke it from that same Apple page at any time, which
          disconnects this app without affecting your account.
        </p>
      </Card>

      {!secretsAvailable && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-medium">Encryption key missing.</p>
          <p className="mt-1 text-muted">
            <code>AGENDA_SECRET</code> isn&rsquo;t set on the server, so an
            Apple password can&rsquo;t be stored safely. Set it before
            connecting an account.
          </p>
        </div>
      )}

      {accounts.length === 0 ? (
        <Empty>No iCloud account connected.</Empty>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="overflow-hidden rounded-xl border border-border bg-surface"
            >
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: account.person_color ?? HOUSEHOLD_COLOR }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{account.label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {account.username}
                  </p>
                  {/* Whose it is decides the colour everything from this
                      account is drawn in, so it has to be changeable. */}
                  <form
                    action={setAccountPerson.bind(null, account.id)}
                    className="mt-1.5 flex items-center gap-1.5"
                  >
                    <select
                      name="person_id"
                      defaultValue={account.person_id ?? "household"}
                      aria-label={`Whose account ${account.label} is`}
                      className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                      <option value="household">The apartment</option>
                    </select>
                    <SubmitButton variant="quiet" size="sm">
                      Save
                    </SubmitButton>
                  </form>
                  {account.last_error && (
                    <p className="mt-1 text-xs text-red-500">
                      {account.last_error}
                    </p>
                  )}
                </div>
                <form action={disconnectICloudAccount.bind(null, account.id)}>
                  <SubmitButton
                    variant="danger"
                    size="icon"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </SubmitButton>
                </form>
              </div>

              {/* Each calendar takes two rows, not one. The name and the Hide
                  button share the first; the owner picker gets the second to
                  itself, because a select wide enough to read "Same as the
                  account (Joao)" and a button beside it do not both fit next to
                  Hide on a phone — they ended up on top of each other. */}
              <ul className="divide-y divide-border">
                {account.calendars.map((calendar) => (
                  <li key={calendar.id} className="px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            calendar.owner_color ?? HOUSEHOLD_COLOR,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {calendar.display_name}
                          {calendar.read_only ? (
                            <span className="ml-2 text-xs text-muted">
                              read-only
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {calendar.owner_name ?? "Apartment"} ·{" "}
                          {calendar.enabled
                            ? `${calendar.event_count} event${
                                calendar.event_count === 1 ? "" : "s"
                              }`
                            : "not shown"}
                        </p>
                      </div>
                      <form action={setCalendarEnabled.bind(null, calendar.id)}>
                        <input
                          type="hidden"
                          name="enabled"
                          value={calendar.enabled ? "0" : "1"}
                        />
                        <SubmitButton variant="quiet" size="sm">
                          {calendar.enabled ? "Hide" : "Show"}
                        </SubmitButton>
                      </form>
                    </div>

                    {/* Not every calendar in one Apple ID belongs to the same
                        person. A shared "Dorm" is the flat's, and saying so is
                        what puts it in the apartment's colour and into the
                        reminders that go to both phones. */}
                    <form
                      action={setCalendarPerson.bind(null, calendar.id)}
                      className="mt-2 flex items-center gap-1.5 pl-5"
                    >
                      <select
                        name="person_id"
                        defaultValue={
                          calendar.owner_set
                            ? (calendar.owner_person_id ?? "household")
                            : "account"
                        }
                        aria-label={`Whose calendar ${calendar.display_name} is`}
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                      >
                        <option value="account">
                          Same as the account
                          {account.person_name
                            ? ` (${account.person_name})`
                            : " (the apartment)"}
                        </option>
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

                    {calendar.last_error && (
                      <p className="mt-1 pl-5 text-xs text-red-500">
                        {calendar.last_error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <Disclosure summary="Connect an iCloud account">
          <ActionForm action={connectICloudAccount} className="space-y-3">
            <Field label="Apple ID">
              <input
                name="username"
                required
                type="email"
                autoComplete="username"
                inputMode="email"
                className={fieldClass}
                placeholder="you@icloud.com"
              />
            </Field>
            <Field label="App-specific password">
              <input
                name="password"
                required
                type="password"
                autoComplete="off"
                className={fieldClass}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
            </Field>
            <Field label="Whose account is it">
              <select name="person_id" className={fieldClass}>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
                <option value="household">The apartment</option>
              </select>
            </Field>
            <Field label="Name it">
              <input
                name="label"
                className={fieldClass}
                placeholder="Joao — iCloud"
              />
            </Field>
            <SubmitButton>Connect</SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>

      {writable.length > 0 && (
        <Card className="mt-3 p-4">
          <p className="text-sm font-medium">Where new events go</p>
          <p className="mb-3 mt-1 text-xs text-muted">
            The calendar already chosen for you when you add an event &mdash;
            you can pick a different one each time. Events written to iCloud
            appear in the Calendar app on both phones, and deleting one here
            removes it from iCloud too.
          </p>
          <ActionForm action={setWriteCalendar} className="flex gap-2">
            <select
              name="calendar_id"
              defaultValue={writeCalendarId ?? "none"}
              className={fieldClass}
            >
              <option value="none">Keep app events in this app only</option>
              {writable.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.display_name}
                </option>
              ))}
            </select>
            <SubmitButton variant="quiet">Save</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
