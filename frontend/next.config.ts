import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the Docker image small: `next build` emits a self-contained server (deployment.md §1).
  output: 'standalone',
  // In a workspace the server has to trace from the repo root, not from
  // `frontend/` — without this the standalone bundle misses hoisted modules and
  // the container starts with a module-not-found instead of a page.
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
};

export default nextConfig;
