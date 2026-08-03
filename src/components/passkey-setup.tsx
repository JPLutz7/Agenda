"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import type { Person } from "@/lib/data";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
} from "@/lib/passkey-actions";
import { ScanFace } from "lucide-react";

/**
 * Turning the Face ID lock on, for this phone.
 *
 * Per phone on purpose, and that's the whole design: the passkey is created by
 * the phone in your hand and can never leave it, so "lock the app" is a
 * sentence that only makes sense about one device at a time. Nino's phone has
 * to do this itself, and the laptop simply never does — which is how a screen
 * you use in the library gets Face ID while the one on your desk doesn't.
 */
export function PasskeySetup({
  people,
  alreadyLocked,
}: {
  people: Person[];
  alreadyLocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [personId, setPersonId] = useState<string>("");

  // Nothing to offer where there's nothing to ask with — a browser older than
  // passkeys. Decided in an effect rather than while rendering: `window` does
  // not exist on the server, so testing it during render makes the server and
  // the browser disagree about what the page says, and React throws out the
  // markup it was given and repaints. Assume it works, then correct.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const name = label.trim() || "This phone";
      const options = await beginPasskeyRegistration(name);
      const response = await startRegistration({ optionsJSON: options });
      const result = await finishPasskeyRegistration(
        response,
        name,
        personId ? Number(personId) : null,
      );
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      router.refresh();
    } catch {
      // Cancelling the prompt lands here too, so this can't read as a fault.
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-muted">
        This browser can&rsquo;t do Face ID. Open the app on your phone and turn
        it on there — it&rsquo;s set per device.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted">
        {alreadyLocked
          ? "This phone asks for Face ID every time the app is opened. Adding it again replaces what's stored for this phone."
          : "Ask for Face ID every time this app is opened on this phone. The dorm passcode still works, and you'll only need it if Face ID can't."}
      </p>

      <div className="mt-3 flex gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="This phone"
          aria-label="Name this phone"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        {people.length > 0 && (
          <select
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            aria-label="Whose phone this is"
            className="rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="">Whose?</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <button
        type="button"
        onClick={register}
        disabled={busy}
        className="pressable mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        <ScanFace className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        {busy
          ? "Ask your phone…"
          : alreadyLocked
            ? "Set up again"
            : "Turn on Face ID"}
      </button>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
