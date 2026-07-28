/** Cents to '$4.29'. Prices are stored as integers so they can't drift. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** 'checked 3 hours ago' — how current a looked-up price is. */
export function sinceLabel(timestamp: string | null): string {
  if (!timestamp) return "never checked";
  // SQLite's datetime('now') is UTC without a zone marker.
  const then = Date.parse(`${timestamp.replace(" ", "T")}Z`);
  if (!Number.isFinite(then)) return "checked recently";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 2) return "just checked";
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `checked ${days}d ago`;
}
