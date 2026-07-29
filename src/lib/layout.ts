/**
 * Working out where events sit in a day column.
 *
 * Two events at the same time can't be drawn on top of each other, so
 * overlapping ones share the column between them: one event fills the day's
 * full width, two take half each, three a third each. This is deliberately a
 * pure function of (start, end) pairs so the fiddly part can be reasoned about
 * and tested without a browser.
 *
 * **It stops at three.** Splitting evenly is the honest way to show how many
 * things are happening at once, and it stays honest right up until a fourth
 * event turns a 116px phone column into four 27px slivers — narrower than one
 * character, so every block in the crowd goes blank. A calendar whose whole
 * promise is that the title and time are always readable cannot draw four
 * events it can't label. Past the limit, the extras come out of `placeEvents`
 * as `overflow` instead: the grid draws one small chip per crowd, and a tap
 * lists what's underneath.
 *
 * How many fit is the caller's business, because it's really a question about
 * pixels: three is the last readable share of a week column, while the day view
 * gives a single day the whole page and can hold twice that.
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
 * The default limit: a third of a 116px week column is 38px, about a word.
 * A fourth share would be 27px, which is narrower than a single character.
 */
export const MAX_COLUMNS = 3;

/** The events one crowd hid, and where to put the chip that reveals them. */
export type Overflow<T extends Placeable> = {
  key: string;
  /** In start order, the way they'd have been drawn. */
  events: T[];
  /**
   * Fraction of the day, 0–1, marking the **bottom** of the crowded stretch —
   * the moment one of the three slots frees up again. The chip hangs upwards
   * from it, which keeps it clear of the titles at the top of every block it
   * crosses.
   */
  at: number;
};

export type Placement<T extends Placeable> = {
  placed: Placed<T>[];
  overflow: Overflow<T>[];
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
 * claiming a share of the width for the whole day. Five events in a chain that
 * are never more than three-deep at any one moment therefore all still get
 * drawn — it's simultaneity that costs width, not company.
 *
 * An event that finds every slot busy is dropped into the cluster's overflow.
 * Being hidden, it then takes no part in the layout: it can't widen the cluster
 * or hold a slot open, or a block nobody can see would be pushing the visible
 * ones around.
 */
export function placeEvents<T extends Placeable>(events: T[]): Placement<T> {
  const sorted = [...events].sort(
    (a, b) => a.startMinutes - b.startMinutes || visualEnd(a) - visualEnd(b),
  );

  const placed: Placed<T>[] = [];
  const overflow: Overflow<T>[] = [];

  let cluster: { event: T; column: number }[] = [];
  /** When each slot in the current cluster frees up. */
  let slotEnds: number[] = [];
  let clusterEnd = -1;
  /** The events this cluster couldn't fit, and the bottom of their crowd. */
  let hidden: T[] = [];
  let crowdEnds = 0;

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
    if (hidden.length > 0) {
      overflow.push({
        key: `more:${hidden[0].key}`,
        events: hidden,
        at: Math.max(0, Math.min(crowdEnds, 1440)) / 1440,
      });
    }
    cluster = [];
    slotEnds = [];
    clusterEnd = -1;
    hidden = [];
    crowdEnds = 0;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinutes >= clusterEnd) flush();

    const free = slotEnds.findIndex((end) => end <= event.startMinutes);
    if (free === -1 && slotEnds.length >= MAX_COLUMNS) {
      // The chip is anchored the first time a cluster overflows, to the end of
      // the crowd rather than the end of the event: a hidden 9-to-5 would
      // otherwise put "+1 more" down at 5pm, hours below the pile-up that
      // caused it. The crowd breaks when the earliest of the three busy slots
      // frees up — or when the hidden event itself ends, if that comes first.
      if (hidden.length === 0) {
        crowdEnds = Math.min(...slotEnds, visualEnd(event));
      }
      hidden.push(event);
      continue;
    }

    const column = free === -1 ? slotEnds.length : free;
    slotEnds[column] = visualEnd(event);

    cluster.push({ event, column });
    clusterEnd = Math.max(clusterEnd, visualEnd(event));
  }
  flush();

  return { placed, overflow };
}

/** Height of an event block as a fraction of the full day, 0–1. */
export function blockGeometry(event: Placeable): { top: number; height: number } {
  const start = Math.max(0, Math.min(event.startMinutes, 1440));
  const end = Math.max(start + MIN_VISUAL_MINUTES, Math.min(visualEnd(event), 1440));
  return { top: start / 1440, height: (end - start) / 1440 };
}
