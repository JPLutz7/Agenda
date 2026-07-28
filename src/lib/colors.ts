/**
 * The colours the calendar is read by.
 *
 * Whose event it is has to be obvious at a glance, at chip size, without
 * reading anything — so each person gets one colour and the apartment gets
 * its own. These live outside `data.ts` because the calendar components are
 * client-side and can't import a server-only module.
 */

/** Events belonging to the apartment rather than to either person. */
export const HOUSEHOLD_COLOR = "#d4a017";

/** The starting colour for each roommate, in the order they were added. */
export const PERSON_PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#059669",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

/**
 * The two people in this household asked for specific colours, and names are
 * the only stable way to tell them apart — ids depend on who was typed in
 * first. Applied once (see `db.ts`), so a colour changed in Setup afterwards
 * stays changed.
 */
export const REQUESTED_COLORS: { match: string; color: string }[] = [
  { match: "nino", color: "#dc2626" }, // red
  { match: "joao", color: "#2563eb" }, // blue
];

/** Lowercased and stripped of accents, so "João" matches "joao". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 0;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Ink that stays readable on a coloured block. White on gold is roughly 2:1 —
 * unreadable at chip size — so light colours get near-black instead.
 */
export function textOn(background: string): string {
  return luminance(background) > 0.3 ? "#16161a" : "#ffffff";
}
