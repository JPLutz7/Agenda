import { cookies } from "next/headers";

/**
 * Light or dark, and where that decision is made.
 *
 * "system" — the default — leaves it to the phone, which is right for almost
 * everyone almost always. The override exists because "almost" isn't "always":
 * a phone set to switch at sunset will flip this app mid-use, and reading a
 * calendar in a dark room is a different preference from reading it on a bus.
 *
 * Kept in a cookie rather than in the database on purpose. It belongs to the
 * phone, not to the dorm — one of them wanting dark shouldn't drag the other
 * into it, and both phones share a single login.
 *
 * Per-device, so it is not a permission and nothing here is trusted: the worst
 * a forged value can do is show you the wrong colours on your own screen.
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
  jar.set(THEME_COOKIE, theme, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
}
