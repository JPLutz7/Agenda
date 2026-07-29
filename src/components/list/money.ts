/** Cents to '$4.29'. Prices are stored as integers so they can't drift. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** '3h ago' — how old a price is. */
function ageLabel(timestamp: string): string | null {
  // SQLite's datetime('now') is UTC without a zone marker.
  const then = Date.parse(`${timestamp.replace(" ", "T")}Z`);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * 'checked 3h ago' / 'you entered this 2d ago'.
 *
 * The distinction matters: a looked-up price is a fact about the shop right
 * now, a typed one is a fact about when you last looked. Saying "checked" for
 * both would let a number you typed in April pass for this morning's price.
 */
export function sinceLabel(
  timestamp: string | null,
  source: string | null = null,
): string {
  if (!timestamp) return "never checked";
  const age = ageLabel(timestamp);
  if (source === "manual") {
    return age ? `you entered this ${age}` : "you entered this";
  }
  if (!age) return "checked recently";
  return age === "just now" ? "just checked" : `checked ${age}`;
}
