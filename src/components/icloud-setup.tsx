import {
  connectICloudAccount,
  disconnectICloudAccount,
  setCalendarEnabled,
  setWriteCalendar,
} from "@/lib/actions";
import type { CalDavAccountView, Person } from "@/lib/data";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";
import { Card, Empty } from "@/components/ui";

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
                  style={{ backgroundColor: account.person_color ?? "#6b7280" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{account.label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {account.username}
                    {account.person_name ? ` · ${account.person_name}` : ""}
                  </p>
                  {account.last_error && (
                    <p className="mt-1 text-xs text-red-500">
                      {account.last_error}
                    </p>
                  )}
                </div>
                <form action={disconnectICloudAccount.bind(null, account.id)}>
                  <SubmitButton variant="danger" className="px-2">
                    ✕
                  </SubmitButton>
                </form>
              </div>

              <ul className="divide-y divide-border">
                {account.calendars.map((calendar) => (
                  <li
                    key={calendar.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
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
                        {calendar.enabled
                          ? `${calendar.event_count} events`
                          : "not shown"}
                      </p>
                      {calendar.last_error && (
                        <p className="mt-1 text-xs text-red-500">
                          {calendar.last_error}
                        </p>
                      )}
                    </div>
                    <form action={setCalendarEnabled.bind(null, calendar.id)}>
                      <input
                        type="hidden"
                        name="enabled"
                        value={calendar.enabled ? "0" : "1"}
                      />
                      <SubmitButton variant="quiet" className="px-2 py-1 text-xs">
                        {calendar.enabled ? "Hide" : "Show"}
                      </SubmitButton>
                    </form>
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
            Events you add in this app get written to this iCloud calendar, so
            they appear in the Calendar app on both phones. Deleting one here
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
