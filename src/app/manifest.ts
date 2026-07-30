import type { MetadataRoute } from "next";

/**
 * Makes "Add to Home Screen" produce a real app entry rather than a bookmark.
 *
 * There is exactly one service worker here (`public/sw.js`) and it has no
 * `fetch` handler. A worker that answers fetches is the usual reason an
 * installed web app gets stuck on an old version — it serves its cache first
 * and needs a correct update dance to ever let go. With nothing intercepting
 * requests, a deploy reaches both phones the next time either of you opens the
 * app, with nothing to invalidate. That file exists only because a phone cannot
 * be sent a notification without one.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agenda",
    short_name: "Agenda",
    description: "What the dorm has going on.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d0d10",
    theme_color: "#2563eb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
