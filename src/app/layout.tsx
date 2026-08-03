import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { LiveRefresh } from "@/components/live-refresh";
import { Relock } from "@/components/relock";
import { getTheme } from "@/lib/prefs";
import { deviceIsLocked, isUnlocked } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Agenda",
  description: "What the dorm has going on.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Agenda", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/** Must match --light-background / --dark-background in globals.css. */
const PAGE_COLOR = { light: "#f6f6f7", dark: "#0d0d10" } as const;

/**
 * The browser chrome's colour, which has to follow the same decision the page
 * does. Left as a pair of media queries it would keep tracking the phone even
 * when Setup says otherwise — a light app under a black status bar.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: PAGE_COLOR.light },
            { media: "(prefers-color-scheme: dark)", color: PAGE_COLOR.dark },
          ]
        : PAGE_COLOR[theme],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read on the server and written into the markup, so a chosen theme is right
  // in the first paint. Doing it in a script on the client is the usual way and
  // it flashes the wrong colours for a frame on every single page load.
  const theme = await getTheme();
  const locked = await deviceIsLocked();
  // A locked phone that hasn't been unlocked can only be looking at the lock
  // screen — everything else was refused before it rendered. So the tab bar
  // would be five taps that all bounce straight back here, on a screen whose
  // whole job is to have one thing on it.
  const showNav = !locked || (await isUnlocked());

  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body className="antialiased">
        <LiveRefresh />
        {locked && <Relock />}
        <main className="mx-auto w-full max-w-2xl px-4 pt-6">{children}</main>
        {showNav && <Nav />}
      </body>
    </html>
  );
}
