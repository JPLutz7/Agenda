"use client";

import { useEffect, useState } from "react";
import { savePushSubscription } from "@/lib/actions";
import type { Person } from "@/lib/data";

/**
 * Turning notifications on, from the phone that wants them.
 *
 * Necessarily a client component: only the browser can ask its owner for
 * permission, and only the browser holds the keys the push service will
 * encrypt to. The server action just writes down what it's handed.
 *
 * The fiddly part is iOS, which grants push **only to a web app that has been
 * added to the Home Screen**. In plain Safari the button would ask, be refused
 * by the operating system rather than by the user, and leave them thinking the
 * app is broken. So that case is detected and explained instead.
 */

type State =
  | { kind: "checking" }
  | { kind: "needs-install" }        // iOS, in Safari rather than installed
  | { kind: "unsupported" }
  | { kind: "blocked" }              // permission previously denied
  | { kind: "off" }
  | { kind: "working" }
  | { kind: "on" }
  | { kind: "error"; message: string };

/**
 * base64url → the bytes PushManager insists on.
 *
 * Typed as an ArrayBuffer rather than a Uint8Array view: TypeScript's DOM types
 * won't accept a view whose backing buffer might be shared, and the `.buffer`
 * of a freshly built array is exactly what's wanted anyway.
 */
function decodeKey(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function isApple(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** True when running as an installed home-screen app rather than in Safari. */
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, older flag; still the only reliable one on iOS.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

export function PushSetup({
  people,
  vapidPublicKey,
}: {
  people: Person[];
  vapidPublicKey: string;
}) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [personId, setPersonId] = useState<string>(
    people[0] ? String(people[0].id) : "",
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On iOS this is what "opened in Safari, not installed" looks like,
        // and it's worth saying so rather than "your browser can't".
        setState({ kind: isApple() && !isInstalled() ? "needs-install" : "unsupported" });
        return;
      }
      if (isApple() && !isInstalled()) {
        setState({ kind: "needs-install" });
        return;
      }
      if (Notification.permission === "denied") {
        setState({ kind: "blocked" });
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/");
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setState({ kind: existing ? "on" : "off" });
    })().catch(() => {
      if (!cancelled) setState({ kind: "unsupported" });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ kind: permission === "denied" ? "blocked" : "off" });
        return;
      }

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required — a push you can't read is no use, and iOS refuses
          // silent pushes outright.
          userVisibleOnly: true,
          applicationServerKey: decodeKey(vapidPublicKey),
        }));

      const json = subscription.toJSON();
      const form = new FormData();
      form.set("endpoint", json.endpoint ?? "");
      form.set("p256dh", json.keys?.p256dh ?? "");
      form.set("auth", json.keys?.auth ?? "");
      form.set("person_id", personId);
      form.set("label", isApple() ? "iPhone" : "This device");

      const result = await savePushSubscription({}, form);
      if (result.error) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setState({ kind: "on" });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const disable = async () => {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
      // The server row is left for the Devices list below to remove, so
      // "turned it off here" and "stop sending to this phone" stay separate
      // acts — one is this browser's business, the other is the household's.
      setState({ kind: "off" });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (state.kind === "checking") {
    return <p className="text-sm text-muted">Checking…</p>;
  }

  if (state.kind === "needs-install") {
    return (
      <div className="text-sm">
        <p className="font-medium">Add Agenda to your Home Screen first.</p>
        <p className="mt-1 text-muted">
          iPhones only allow notifications for a web app that has been
          installed. In Safari, tap the Share button, then{" "}
          <strong>Add to Home Screen</strong>. Open it from the icon and come
          back here.
        </p>
      </div>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <p className="text-sm text-muted">
        This browser can&rsquo;t do notifications. Nothing else in the app is
        affected.
      </p>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div className="text-sm">
        <p className="font-medium">Notifications are blocked for this app.</p>
        <p className="mt-1 text-muted">
          The browser is refusing, not the app, so there&rsquo;s no button that
          can undo it. On iPhone: Settings → Notifications → Agenda. Then come
          back.
        </p>
      </div>
    );
  }

  return (
    <div className="text-sm">
      {state.kind === "on" ? (
        <>
          <p className="font-medium">This phone is set up.</p>
          <p className="mt-1 text-muted">
            You&rsquo;ll get a chore on the day it&rsquo;s yours, a price drop
            worth knowing about, and anything your roommate adds to the list.
          </p>
          <button
            type="button"
            onClick={disable}
            className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm font-medium"
          >
            Turn off on this phone
          </button>
        </>
      ) : (
        <>
          {people.length > 0 && (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Whose phone is this?
              </span>
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">
                One passcode is shared, so the app has to be told. It&rsquo;s
                how a chore reminder reaches whoever&rsquo;s turn it is.
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={enable}
            disabled={state.kind === "working"}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {state.kind === "working" ? "…" : "Turn on notifications"}
          </button>
        </>
      )}

      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {state.message}
        </p>
      )}
    </div>
  );
}
