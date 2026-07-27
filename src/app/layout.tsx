import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Agenda",
  description: "What the apartment has going on.",
  appleWebApp: { capable: true, title: "Agenda", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto w-full max-w-2xl px-4 pt-6">{children}</main>
        <Nav />
      </body>
    </html>
  );
}
