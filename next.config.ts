import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const x402FetchStubPath = path.join(configDirectory, "app/lib/cdp/x402-fetch-stub.ts");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.160"],
  turbopack: {
    root: configDirectory,
    resolveAlias: {
      "x402-fetch": x402FetchStubPath,
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      tailwindcss: path.join(configDirectory, "node_modules/tailwindcss"),
      "x402-fetch": x402FetchStubPath,
    };

    return config;
  },
};

export default nextConfig;
