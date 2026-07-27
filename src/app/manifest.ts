import type { MetadataRoute } from "next";

/**
 * Makes "Add to Home Screen" produce a real app entry rather than a bookmark.
 *
 * Deliberately no service worker anywhere in this project. A service worker is
 * the usual reason an installed web app gets stuck on an old version — it
 * serves its cache first and needs a correct update dance to ever let go. This
 * app is server-rendered and always fetches, so a deploy reaches both phones
 * the next time either of you opens it, with nothing to invalidate.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agenda",
    short_name: "Agenda",
    description: "What the apartment has going on.",
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
