/**
 * Background calendar sync.
 *
 * Next.js calls register() once when the server process starts. Because this
 * deployment runs a machine that's always on, we can keep a plain interval
 * here instead of depending on an external scheduler to poke an endpoint.
 *
 * The point is that iCloud data is already current when someone opens the app,
 * rather than the first page load having to wait on a fetch to Apple. The
 * on-demand refresh in lib/sync.ts stays as a safety net for the case where
 * this process has only just started.
 */

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export async function register() {
  // Only the Node.js server runtime has a database or a filesystem; skip the
  // edge runtime and the build-time passes entirely.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Imported lazily so the native better-sqlite3 module is never pulled into
  // a build or edge bundle.
  const { syncAllFeeds } = await import("./lib/sync");

  const run = async () => {
    try {
      const results = await syncAllFeeds();
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        // Feed errors are also surfaced per-calendar in Setup; this is just
        // so they show up in `fly logs` too.
        for (const f of failed) {
          console.warn(`[agenda] feed "${f.label}" failed: ${f.error}`);
        }
      }
    } catch (err) {
      // Never let a sync failure take the server down with it.
      console.error("[agenda] background sync failed", err);
    }
  };

  // A short delay so startup isn't competing with the first request.
  setTimeout(run, 5_000);
  const timer = setInterval(run, SYNC_INTERVAL_MS);
  // Don't hold the process open on shutdown.
  timer.unref?.();
}
