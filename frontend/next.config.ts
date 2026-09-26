import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keeps the Docker image small: `next build` emits a self-contained server (deployment.md §1).
  output: 'standalone',
  poweredByHeader: false,
};

export default nextConfig;
