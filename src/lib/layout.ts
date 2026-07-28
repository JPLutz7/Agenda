/**
 * Working out where events sit in a day column.
 *
 * Two events at the same time can't be drawn on top of each other, so
 * overlapping ones share the column between them: one event fills the day's
 * full width, two take half each, three a third each. This is deliberately a
 * pure function of (start, end) pairs so the fiddly part can be reasoned about
 * and tested without a browser.
 */

export type Placeable = {
  key: string;
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
};

export type Placed<T extends Placeable> = T & {
  /** Fraction of the column width, 0–1. */
  left: number;
  width: number;
  /** Which side-by-side slot this event took. Drawing order. */
  column: number;
};

/**
 * Every block has to be tall enough for a line of text, since the title and
 * time must stay readable however brief the event is. Two events minutes
 * apart therefore count as overlapping — they would be drawn on top of each
 * other otherwise.
 */
const MIN_VISUAL_MINUTES = 30;

function visualEnd(event: Placeable): number {
  return Math.max(event.endMinutes, event.startMinutes + MIN_VISUAL_MINUTES);
}

/**
 * Splits the day into clusters of events that overlap directly or through a
 * chain of others, then divides each cluster's width evenly. Without the
 * clustering, one long event (a 9-to-5) would squeeze the entire day narrow
 * even where nothing else is happening.
 *
 * Within a cluster each event takes the first slot free at its start time, so
 * a morning and an afternoon event can share one slot rather than each
 * claiming a share of the width for the whole day.
 */
export function placeEvents<T extends Placeable>(events: T[]): Placed<T>[] {
  const sorted = [...events].sort(
    (a, b) => a.startMinutes - b.startMinutes || visualEnd(a) - visualEnd(b),
  );

  const placed: Placed<T>[] = [];
  let cluster: { event: T; column: number }[] = [];
  /** When each slot in the current cluster frees up. */
  let slotEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columns = slotEnds.length;
    for (const { event, column } of cluster) {
      placed.push({
        ...event,
        left: column / columns,
        width: 1 / columns,
        column,
      });
    }
    cluster = [];
    slotEnds = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinutes >= clusterEnd) flush();

    const free = slotEnds.findIndex((end) => end <= event.startMinutes);
    const column = free === -1 ? slotEnds.length : free;
    slotEnds[column] = visualEnd(event);

    cluster.push({ event, column });
    clusterEnd = Math.max(clusterEnd, visualEnd(event));
  }
  flush();

  return placed;
}

/** Height of an event block as a fraction of the full day, 0–1. */
export function blockGeometry(event: Placeable): { top: number; height: number } {
  const start = Math.max(0, Math.min(event.startMinutes, 1440));
  const end = Math.max(start + MIN_VISUAL_MINUTES, Math.min(visualEnd(event), 1440));
  return { top: start / 1440, height: (end - start) / 1440 };
}
