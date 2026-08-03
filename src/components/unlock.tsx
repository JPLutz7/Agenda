"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  beginUnlock,
  escapeToPasscode,
  finishUnlock,
} from "@/lib/passkey-actions";
import { ScanFace } from "lucide-react";

type State = "idle" | "asking" | "done" | "failed";

/**
 * The Face ID prompt, and the only thing on the screen behind it.
 *
 * Asks immediately on arrival rather than waiting for a tap: opening the app
 * *is* the request, and a button you have to press first turns a glance into a
 * tap and a glance. The button stays for the second attempt, because iOS gives
 * up after a few seconds of not seeing a face and there has to be a way back
 * without reloading.
 *
 * Nothing is rendered under this. The page you were heading for was never sent
 * — the server refused it — so there is no content here to peek at.
 */
export function Unlock({ destination }: { destination: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development, and two overlapping WebAuthn
  // ceremonies cancel each other — the first prompt vanishes as the second
  // starts, which looks exactly like Face ID failing.
  const started = useRef(false);

  const ask = useCallback(async () => {
    setState("asking");
    setError(null);
    try {
      const options = await beginUnlock();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishUnlock(response);
      if (!result.ok) {
        setState("failed");
        setError(result.error ?? "That didn't work.");
        return;
      }
      setState("done");
      // replace, not push: the lock screen must not be somewhere the back
      // button can return to.
      router.replace(destination);
      router.refresh();
    } catch {
      // Includes the ordinary case of somebody dismissing the prompt, so the
      // wording can't imply something went wrong.
      setState("failed");
      setError(null);
    }
  }, [destination, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask();
  }, [ask]);

  return (
    <div className="mx-auto mt-24 flex max-w-sm flex-col items-center px-6 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent"
        aria-hidden="true"
      >
        <ScanFace className="h-8 w-8" strokeWidth={1.6} />
      </span>

      <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">
        Agenda is locked
      </h1>
      <p className="mt-1 text-sm text-muted">
        {state === "asking"
          ? "Look at your phone…"
          : state === "done"
            ? "Unlocked."
            : "Unlock with Face ID to carry on."}
      </p>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={ask}
        disabled={state === "asking" || state === "done"}
        className="pressable mt-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {state === "asking" ? "Waiting…" : "Unlock"}
      </button>

      {/* The way out when Face ID can't help: a new phone, a broken camera, a
          passkey deleted from the other phone. It signs this device out rather
          than letting it in, so the passcode is still the thing that has to be
          typed — the lock is never simply skipped.

          A form, not a link: it changes something, and a link that changes
          something is one the browser is free to follow while merely guessing
          where you might tap next. */}
      <form action={escapeToPasscode} className="mt-4">
        <button
          type="submit"
          className="text-xs text-muted underline underline-offset-2"
        >
          Use the dorm passcode instead
        </button>
      </form>
    </div>
  );
}
