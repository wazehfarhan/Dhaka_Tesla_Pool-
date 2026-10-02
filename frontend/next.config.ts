import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the Docker image small: `next build` emits a self-contained server (deployment.md §1).
  //
  // …except on Vercel, where standalone is actively harmful. Vercel injects its
  // own build adapter (NEXT_ADAPTER_PATH → @vercel/next's dist/adapter), and
  // Next runs that adapter *before* the `output: 'standalone'` post-processing
  // (see the comment above `adapter-handle-build-complete` in Next's
  // build/index.js — "in the future output: standalone might not be allowed if
  // an adapter with onBuildComplete is configured"). The adapter writes
  // `routes-manifest-deterministic.json` next to routes-manifest.json and
  // registers it as a build-output asset; standalone handling then leaves that
  // file missing from `.next/`, so the deploy dies after "Build Completed" with
  // `ENOENT: … .next/routes-manifest-deterministic.json`. Same failure family as
  // vercel/next.js#96646 (`output: 'standalone'` breaks Next 16.3 on Vercel),
  // whose shipped workaround is exactly this. Docker never sets VERCEL, so the
  // image below still gets its standalone server.
  output: process.env.VERCEL ? undefined : 'standalone',
  // In a workspace the server has to trace from the repo root, not from
  // `frontend/` — without this the standalone bundle misses hoisted modules and
  // the container starts with a module-not-found instead of a page.
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
};

export default nextConfig;
