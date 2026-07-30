"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

/**
 * One button, three intents, three sizes — and nothing else.
 *
 * Every button in the app came through here already, but each caller was also
 * passing its own padding, so "Done", "Check", "Got it" and "Save" ended up
 * four different heights sitting next to each other. The sizes are named here
 * instead: `md` for anything a thumb aims at deliberately, `sm` for controls
 * riding along inside a row, `icon` for a square that holds one glyph.
 */
const VARIANTS = {
  primary: "bg-accent text-white hover:opacity-90",
  quiet: "border border-border bg-surface-muted text-foreground hover:border-muted",
  danger: "text-muted hover:text-red-500 hover:bg-red-500/10",
} as const;

const SIZES = {
  md: "rounded-lg px-3.5 py-2 text-sm",
  sm: "rounded-md px-2.5 py-1.5 text-xs",
  // Square, and at least 36px so it's still a fair target on a phone.
  icon: "rounded-lg h-9 w-9 inline-flex items-center justify-center",
} as const;

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className = "",
  title,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`pressable shrink-0 font-medium transition disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {/* An icon button has no room for "…", and swapping the glyph for one
          would resize the button mid-press. Fading is enough of a signal. */}
      {pending && size !== "icon" ? "…" : children}
    </button>
  );
}

/** Inputs there is nothing useful to put back: React re-renders them itself. */
const NOT_RESTORED = new Set([
  "file", // a FormData File can't be assigned back to an input
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
]);

/**
 * Puts the submitted values back into the fields after a failed submission.
 *
 * React 19 resets an uncontrolled form as soon as its action settles — which is
 * right when the submission worked, and wrong when it didn't. A rejected event
 * took the title, the notes and the destination calendar down with it, so the
 * penalty for one bad end time was typing the whole thing again. Every value
 * written here is the one the form just sent, so a field React controls (which
 * kept its own state through the reset, and is the reason "start time" already
 * survived) is written back to exactly what it already shows.
 */
function restoreValues(
  form: HTMLFormElement | null,
  submitted: FormData | null,
): void {
  if (!form || !submitted) return;
  /** Two fields can share a name; they take their values in document order. */
  const used = new Map<string, number>();

  for (const element of Array.from(form.elements)) {
    const field =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element
        : null;
    if (!field || !field.name) continue;
    if (field instanceof HTMLInputElement && NOT_RESTORED.has(field.type)) {
      continue;
    }

    const values = submitted
      .getAll(field.name)
      .filter((value): value is string => typeof value === "string");

    // A tickbox is in the FormData only when it was ticked, so an absent name
    // is itself the value: unticked.
    if (
      field instanceof HTMLInputElement &&
      (field.type === "checkbox" || field.type === "radio")
    ) {
      field.checked = values.includes(field.value);
      continue;
    }

    if (field instanceof HTMLSelectElement && field.multiple) {
      for (const option of Array.from(field.options)) {
        option.selected = values.includes(option.value);
      }
      continue;
    }

    const index = used.get(field.name) ?? 0;
    used.set(field.name, index + 1);
    const value = values[index];
    if (value !== undefined) field.value = value;
  }
}

/**
 * Wraps a server action and surfaces whatever it returns. Forms that add
 * something (a list item, a chore) clear themselves once the action succeeds,
 * and every form keeps what was typed when the action comes back with an error.
 */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
  onSuccess,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /**
   * Called after the action succeeds. Needed for fields React controls:
   * form.reset() restores the DOM but can't touch component state, so a
   * controlled input would keep its old value into the next entry.
   */
  onSuccess?: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  /** The last submission, kept only long enough to put it back on an error. */
  const submitted = useRef<FormData | null>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    (previous, form) => {
      submitted.current = form;
      return action(previous, form);
    },
    {},
  );

  useEffect(() => {
    if (state.ok !== undefined && !state.error) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
      submitted.current = null;
      return;
    }
    // React has just cleared the fields on its way out of the action, so this
    // runs on every error — including the same error twice in a row, which is
    // why it can't be conditional on the message having changed.
    if (state.error) restoreValues(ref.current, submitted.current);
    // Only re-run when the action reports back, not when the parent
    // re-renders and hands us a new callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

export const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * A <details> that closes itself after the form inside it succeeds, so adding
 * something doesn't leave the form hanging open.
 */
export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-accent">
        <span className="group-open:hidden">+ {summary}</span>
        <span className="hidden group-open:inline">Cancel</span>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
