import { cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Runs the production build.
 *
 * `next start` cannot be used here: with output: "standalone" it boots and
 * serves pages, but server actions silently do nothing — forms submit and no
 * mutation happens, with no error anywhere. Next prints a warning about this
 * that is easy to miss.
 *
 * The standalone bundle expects .next/static and public to sit beside it, so
 * copy them across before starting, the same way the Dockerfile does.
 */

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

try {
  await access(path.join(standalone, "server.js"));
} catch {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}

await cp(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);

try {
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
} catch {
  // A project without a public directory is fine.
}

spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit",
  env: process.env,
}).on("exit", (code) => process.exit(code ?? 0));
