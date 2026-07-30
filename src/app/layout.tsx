import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { LiveRefresh } from "@/components/live-refresh";

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d10" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <LiveRefresh />
        <main className="mx-auto w-full max-w-2xl px-4 pt-6">{children}</main>
        <Nav />
      </body>
    </html>
  );
}
