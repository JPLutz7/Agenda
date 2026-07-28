/**
 * Working out where events sit in a day column.
 *
 * Two events at the same time can't be drawn on top of each other, so
 * overlapping ones are placed side by side — the arrangement every calendar
 * app uses. This is deliberately a pure function of (start, end) pairs so the
 * fiddly part can be reasoned about and tested without a browser.
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
  /** How many overlapping events start before this one. Drawing order. */
  depth: number;
};

/**
 * How far each overlapping event is nudged right, as a fraction of the column.
 * Splitting the width equally instead — the obvious approach — falls apart on
 * a phone: four overlapping events in a 45px column give four 11px slivers,
 * too narrow for a single character, so the day reads as coloured noise.
 * Cascading keeps every block wide enough to carry a title, and the staircase
 * makes the overlap obvious at a glance.
 */
const CASCADE_STEP = 0.16;
/** Past this many, further events stack in place rather than vanishing. */
const MAX_CASCADE = 3;

/**
 * Every block has to be tall enough for a line of text, since the title and
 * time must stay readable however brief the event is.
 */
const MIN_VISUAL_MINUTES = 30;

function visualEnd(event: Placeable): number {
  return Math.max(event.endMinutes, event.startMinutes + MIN_VISUAL_MINUTES);
}

/**
 * Splits the day into clusters of events that overlap directly or through a
 * chain of others, then lays out each cluster independently. Without the
 * clustering, one long event (a 9-to-5) would squeeze the entire day narrow
 * even where nothing else is happening.
 */
export function placeEvents<T extends Placeable>(events: T[]): Placed<T>[] {
  const sorted = [...events].sort(
    (a, b) => a.startMinutes - b.startMinutes || visualEnd(a) - visualEnd(b),
  );

  const placed: Placed<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;

    for (const event of cluster) {
      // Only events actually running at the same time push this one right.
      // Counting the whole cluster would indent an afternoon event because
      // of something unrelated that morning.
      const overlappingBefore = cluster.filter(
        (other) =>
          other !== event &&
          other.startMinutes <= event.startMinutes &&
          visualEnd(other) > event.startMinutes,
      ).length;

      const depth = Math.min(overlappingBefore, MAX_CASCADE);
      const left = depth * CASCADE_STEP;
      placed.push({ ...event, left, width: 1 - left, depth });
    }

    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinutes >= clusterEnd) flush();
    cluster.push(event);
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
