import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and node-ical pulls in node-only deps —
  // neither can be bundled by webpack.
  serverExternalPackages: ["better-sqlite3", "node-ical"],
  // Emits a self-contained server bundle, which is what the Dockerfile ships.
  output: "standalone",
};

export default nextConfig;
