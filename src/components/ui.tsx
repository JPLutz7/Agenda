import type { ReactNode } from "react";
import { syncNow } from "@/lib/actions";
import { textOn } from "@/lib/colors";
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

/**
 * A raised surface: the one description of "a box holding things", written once.
 *
 * It was this exact string in six files, which is why some of them had picked up
 * a shadow and others hadn't, and why one had drifted to a different corner
 * radius. Anything grouping rows should use it.
 */
export const panelClass =
  "panel rounded-xl border border-border bg-surface";

/** The same, for a list of rows with hairlines between them. */
export const listClass = `${panelClass} divide-y divide-border overflow-hidden`;

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`${panelClass} ${className}`}>{children}</section>;
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
export function tintedBlock(
  color: string,
  /** "strong" is for a single large block, not for rows in a list. */
  strength: "normal" | "strong" = "normal",
): React.CSSProperties {
  const amount =
    strength === "strong" ? "var(--tint-strong)" : "var(--tint-strength)";
  return {
    background: `color-mix(in srgb, ${color} ${amount}, var(--color-surface))`,
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

/**
 * Whose something is, as a block of colour with their initial in it.
 *
 * This app had colour and barely showed any: a 3px hairline down the side of a
 * row, an 8px dot. The apps worth copying do the opposite — Dime gives every
 * row a saturated tile and it's most of what you see on the screen; Lumy paints
 * whole surfaces. Colour that small isn't restraint, it's just grey with a
 * stripe.
 *
 * The initial does real work as well as carrying the colour: on a shared
 * calendar the question is nearly always *whose*, and a letter answers it
 * without the legend at the bottom of the calendar page.
 */
export function OwnerTile({
  color,
  name,
}: {
  color: string;
  /** Null is the dorm's — both roommates', which is a name of its own. */
  name: string | null;
}) {
  const label = name ?? "Dorm";
  return (
    <span
      title={label}
      // Not aria-hidden. The letter replaced a written-out name in the row, so
      // hiding it would take "whose is this" away from a screen reader
      // entirely — the one reader that can't infer J from the colour.
      role="img"
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-lg text-[0.6875rem] font-bold"
      style={{ backgroundColor: color, color: textOn(color) }}
    >
      <span aria-hidden="true">{label.trim().charAt(0).toUpperCase()}</span>
    </span>
  );
}

/** A row's background, washed with whose it is. */
export function ownerWash(color: string, strength = "9%"): string {
  return `color-mix(in srgb, ${color} ${strength}, var(--color-surface))`;
}
