import { cookies } from "next/headers";
import { isListSort, type ListSort } from "./list-sort";

/**
 * What this phone remembers.
 *
 * Everything here is a per-device preference kept in a cookie rather than in
 * the database, because it belongs to the phone and not to the dorm — both
 * phones share a single login, so anything stored centrally would have one
 * roommate's choice reach across and change the other's screen.
 *
 * Nothing here is a permission and nothing here is trusted: the worst a forged
 * value can do is show you the wrong colours, or your own list in the wrong
 * order, on your own screen.
 */

/**
 * Light or dark, and where that decision is made.
 *
 * "system" — the default — leaves it to the phone, which is right for almost
 * everyone almost always. The override exists because "almost" isn't "always":
 * a phone set to switch at sunset will flip this app mid-use, and reading a
 * calendar in a dark room is a different preference from reading it on a bus.
 */

export const THEME_COOKIE = "agenda_theme";

export type Theme = "system" | "light" | "dark";

export function isTheme(value: string | undefined): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export async function getTheme(): Promise<Theme> {
  const jar = await cookies();
  const raw = jar.get(THEME_COOKIE)?.value;
  return isTheme(raw) ? raw : "system";
}

export async function setTheme(theme: Theme): Promise<void> {
  const jar = await cookies();
  if (theme === "system") {
    // Deleting rather than storing "system" so the absence of the cookie and
    // the default mean the same thing, and there's only one state to reason
    // about when nothing has been chosen.
    jar.delete(THEME_COOKIE);
    return;
  }
  jar.set(THEME_COOKIE, theme, COOKIE_OPTIONS);
}

/**
 * How the shopping list is ordered.
 *
 * Remembered rather than carried in the address, because the two people using
 * it want different things out of it: one sorts by price and keeps sorting by
 * price, the other never touches it. Making the choice stick means it's made
 * once, not once per visit.
 */

export const LIST_SORT_COOKIE = "agenda_list_sort";

export async function getListSort(): Promise<ListSort> {
  const jar = await cookies();
  const raw = jar.get(LIST_SORT_COOKIE)?.value;
  return isListSort(raw) ? raw : "added";
}

export async function setListSort(sort: ListSort): Promise<void> {
  const jar = await cookies();
  if (sort === "added") {
    // Same reasoning as "system" above: the default is the absence of a
    // cookie, so there's one state to think about and not two.
    jar.delete(LIST_SORT_COOKIE);
    return;
  }
  jar.set(LIST_SORT_COOKIE, sort, COOKIE_OPTIONS);
}

const COOKIE_OPTIONS = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 365 * 86_400,
} as const;
