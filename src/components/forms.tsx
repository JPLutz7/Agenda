"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

export function SubmitButton({
  children,
  variant = "primary",
  className = "",
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "quiet" | "danger";
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-accent text-white hover:opacity-90",
    quiet:
      "border border-border bg-surface-muted text-foreground hover:border-muted",
    danger: "text-muted hover:text-red-500",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

/**
 * Wraps a server action and surfaces whatever it returns. Forms that add
 * something (a list item, a chore) clear themselves once the action succeeds.
 */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok !== undefined && !state.error) {
      ref.current?.reset();
    }
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
