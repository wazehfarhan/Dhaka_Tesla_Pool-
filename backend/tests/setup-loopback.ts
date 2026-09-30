import { createRequire } from 'node:module';

/**
 * Foreign-server flake defence — supertest server URL pinning.
 *
 * What the kernel probes established (see session log / docs/testing.md notes):
 *   1. supertest's ephemeral servers bind the IPv6 wildcard `::` (dual-stack)
 *      and its `serverAddress()` rewrites that to `127.0.0.1` in the URL.
 *   2. A foreign IPv4 listener CAN co-bind the same port over our `::`
 *      (E6: succeeded even without SO_REUSEADDR on their side — Node's bind is
 *      permissive), and when both sockets exist, **connections dialled at
 *      127.0.0.1 are delivered to the FOREIGN IPv4 socket** (E4, W2), while a
 *      dial at `[::1]` can only reach IPv6 sockets.
 *   3. Identical-address re-binds are refused without SO_REUSEPORT (M2), and
 *      no foreign process observed on this machine listens on `::1`.
 *
 * So: dialling the IPv6 loopback `[::1]` directly (no DNS involved) removes the
 * entire class of "some other process answered our test request" failures
 * without changing how the server binds — a socket bound to the dual-stack
 * wildcard `::` accepts `::1` connections, while every foreign IPv4 listener
 * on this machine (127.0.0.1/0.0.0.0) physically cannot. supertest's
 * synchronous `app.address()` contract also stays intact (passing a host to
 * `listen()` defers the bind and breaks it, which is why we rewrite the URL
 * instead of the bind).
 *
 * Test-only: loaded from `setupFiles` in vitest.config.ts, never ships.
 */
const require = createRequire(import.meta.url);
const { Test } = require('supertest') as {
  Test: { prototype: { serverAddress(app: unknown, path: string): string } };
};

const originalServerAddress = Test.prototype.serverAddress;

Test.prototype.serverAddress = function patchedServerAddress(
  this: unknown,
  app: unknown,
  path: string,
): string {
  const url = originalServerAddress.call(this, app, path);
  // supertest maps the dual-stack `::` wildcard to 127.0.0.1 in the URL; aim
  // the dial at ::1 instead so only an IPv6 socket can answer it.
  return url.replace('http://127.0.0.1:', 'http://[::1]:');
};
