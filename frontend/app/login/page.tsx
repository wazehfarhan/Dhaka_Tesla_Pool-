/**
 * `/login` — placeholder for the Phase 1 scaffold.
 *
 * It exists now because `docker-compose` (Phase 12) healthchecks the web container against
 * `/login` — the root route redirects, which would fail a strict 200 check (deployment.md §1).
 * The real form, token handling and role redirect land in Phase 3/10 (ui-ux.md §2, §5).
 */
export default function LoginPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Login</h1>
      <p className="text-slate-700">
        Authentication arrives in Phase 3 (JWT access token in memory + rotating refresh cookie).
      </p>

      <form className="max-w-sm space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <fieldset disabled className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700">Email</span>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              name="email"
              placeholder="nusrat@example.com"
              type="email"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Password</span>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              name="password"
              placeholder="••••••••"
              type="password"
            />
          </label>
          <button
            className="w-full rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50"
            type="submit"
          >
            Login (Phase 3)
          </button>
        </fieldset>
        <p className="text-xs text-slate-500">
          Disabled until the auth module exists — no fake success states in this scaffold.
        </p>
      </form>
    </div>
  );
}
