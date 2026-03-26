import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: configDirectory,
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      tailwindcss: path.join(configDirectory, "node_modules/tailwindcss"),
    };

    return config;
  },
};

export default nextConfig;
