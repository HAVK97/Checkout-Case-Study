import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  // liteparse ships a native .node binding; bundling it (Turbopack/webpack)
  // breaks, so it must be required at runtime instead.
  serverExternalPackages: ["@llamaindex/liteparse"],
};

export default nextConfig;
