import type { ReactNode } from "react";
import { syncNow } from "@/lib/actions";
import { RefreshButton } from "@/components/refresh-button";

/**
 * Every page's title bar, and the only place the refresh button is defined —
 * so it's in the same corner on all of them rather than five near-misses.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      {/* min-w-0 so a long title wraps rather than pushing the button off. */}
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-1">
        {action}
        <form action={syncNow}>
          <RefreshButton />
        </form>
      </div>
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 mt-7 text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </h2>
  );
}

/**
 * A calendar block's colours, from whoever owns it.
 *
 * A tint rather than a solid fill. Solid blocks were readable but turned a busy
 * week into a wall of paint, and the title had to be reversed out in white,
 * which is the weaker of the two contrasts available. Tinted, the title stays
 * the darkest thing in the block and the colour still says whose it is at a
 * glance. `color-mix` does the blending against whatever surface is behind it,
 * so the same rule works in both light and dark.
 */
export function tintedBlock(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} var(--tint-strength), var(--color-surface))`,
    // The solid edge is what survives at chip size, when the tint is too small
    // an area to read as a colour at all.
    borderInlineStart: `3px solid ${color}`,
  };
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/** A person's color, as a dot. */
export function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}
