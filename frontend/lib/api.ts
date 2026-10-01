/**
 * The only place the frontend talks to the API (api.md §1).
 *
 * Responsibilities, in order of importance:
 * 1. **Silent refresh** — a `401` triggers exactly one `POST /auth/refresh` (with
 *    the `httpOnly` cookie, `credentials: 'include'`), then the original request
 *    is retried once. Concurrent 401s share one refresh promise, so a dashboard
 *    with three polls in flight does not rotate the cookie three times (which
 *    would invalidate its own tokens — refresh rotation, security.md §1).
 * 2. **Envelope handling** — `{success, data, meta}` in, `data` out; the error
 *    envelope becomes a typed `ApiError` carrying the documented code.
 * 3. **No secrets in URLs or storage** — the bearer header is built here from the
 *    in-memory token store.
 */

import { API_BASE } from './env';
import { ApiError, NetworkError } from './errors';
import { clearRoleCookie, clearSessionHint, setSessionHint } from './cookies';
import { clearAccessToken, getAccessToken, setAccessToken } from './token-store';
import type {
  ApiEnvelope,
  ApiErrorBody,
  CancelledRide,
  CreatedRide,
  CreateRideRequest,
  DriverPoolDetail,
  DriverPoolListItem,
  DriverTransitionResponse,
  FareEstimate,
  Payment,
  RideDetail,
  RideListItem,
  UserProfile,
  VehicleStatusResponse,
  VehicleSummary,
  Zone,
} from './types';

const REQUEST_TIMEOUT_MS = 15_000;

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Defaults to true: every documented endpoint except auth/zones needs a bearer. */
  authenticated?: boolean;
}

interface CallResult<T> {
  data: T;
  status: number;
  meta?: { page: number; limit: number; total: number };
}

/**
 * The outcome of a session restore.
 *
 * `throttled` exists because `429` is **not** an authentication failure. A page
 * reload legitimately calls `/auth/refresh`, so a burst of reloads can hit the
 * limiter while the `httpOnly` cookie is still perfectly valid. Treating that as
 * a sign-out cleared the session and threw the user back to `/login` — losing a
 * session that was never lost. The limiter stays on; the client just has to tell
 * "wait a moment" apart from "sign in again".
 */
export type RefreshOutcome = 'restored' | 'anonymous' | 'throttled';

/** Single-flight refresh — all racing 401s await the same rotation. */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Every real sign-out clears the same three things: token, role, session hint. */
function dropSession(): void {
  clearAccessToken();
  clearRoleCookie();
  clearSessionHint();
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A proxy or crash page answered with HTML — treat it as a server fault, not as data.
    throw new NetworkError('The server returned an unexpected response.');
  }
}

/**
 * `POST /auth/refresh` — the one call that may run without a token. Reports
 * whether the session was restored, was genuinely absent, or is merely throttled;
 * only the middle case clears the session (see `RefreshOutcome`).
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429) {
        // Keep the hint: the cookie is still there, we were merely too fast.
        return 'throttled' as const;
      }
      if (!response.ok) {
        dropSession();
        return 'anonymous' as const;
      }
      const envelope = (await parseBody(response)) as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(envelope.data.accessToken);
      setSessionHint();
      return 'restored' as const;
    } catch {
      // A network failure is not proof the session ended; keep the hint so the
      // next load tries again instead of stranding the user at `/login`.
      return 'throttled' as const;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<CallResult<T>> {
  const { method = 'GET', body, authenticated = true } = options;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getAccessToken();
    if (authenticated && token !== null) headers.Authorization = `Bearer ${token}`;

    return fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new NetworkError('The server took too long to answer. Please try again.');
    }
    throw new NetworkError();
  }

  // Expired access token → refresh once → retry once. A second 401 is a real sign-out.
  if (response.status === 401 && authenticated) {
    const outcome = await refreshAccessToken();
    if (outcome === 'restored') {
      try {
        response = await send();
      } catch {
        throw new NetworkError();
      }
    } else if (outcome === 'throttled') {
      // Say "wait", never "sign in again": the session is fine, we were throttled.
      throw new ApiError(429, undefined, 'Too many attempts. Please wait a moment and try again.');
    } else {
      const rejected = (await parseBody(response).catch(() => undefined)) as
        ApiErrorBody | undefined;
      throw new ApiError(401, rejected, 'Your session expired. Please sign in again.');
    }
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody | undefined, 'Request failed.');
  }

  const envelope = payload as ApiEnvelope<T>;
  if (envelope === undefined || envelope.success !== true) {
    throw new ApiError(response.status, payload as ApiErrorBody | undefined, 'Request failed.');
  }

  return { data: envelope.data, status: response.status, meta: envelope.meta };
}

/**
 * `POST /auth/login` → `{data:{user, accessToken}}` plus the refresh cookie.
 * The cookie is set by the backend; the browser stores it because the call is
 * same-site cross-port with `credentials: 'include'`.
 */
export async function login(email: string, password: string): Promise<UserProfile> {
  const { data } = await call<{ user: UserProfile; accessToken: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    authenticated: false,
  });
  setAccessToken(data.accessToken);
  setSessionHint();
  return data.user;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: 'PASSENGER' | 'DRIVER';
}

/** `201` with the created profile — signing in is a separate, explicit step. */
export async function register(input: RegisterInput): Promise<UserProfile> {
  const { data } = await call<UserProfile>('/auth/register', {
    method: 'POST',
    body: input,
    authenticated: false,
  });
  return data;
}

/** Best-effort: the API clears the cookie, the client clears its own memory either way. */
export async function logout(): Promise<void> {
  try {
    await call<void>('/auth/logout', { method: 'POST', authenticated: false });
  } finally {
    dropSession();
  }
}

export async function fetchMe(): Promise<UserProfile> {
  const { data } = await call<UserProfile>('/auth/me');
  return data;
}

/** 🔓 Public dropdown data (api.md §3) — the only endpoint a guest may call. */
export async function fetchZones(): Promise<Zone[]> {
  const { data } = await call<Zone[]>('/zones', { authenticated: false });
  return data;
}

export interface EstimateInput {
  pickupZone: string;
  destinationZone: string;
  seats: number;
}

/** `POST /fare/estimate` — the live FareCard + seat cap behind the request form. */
export async function estimateFare(input: EstimateInput): Promise<FareEstimate> {
  const { data } = await call<FareEstimate>('/fare/estimate', { method: 'POST', body: input });
  return data;
}

/** `POST /rides` — `replayed` is true when the idempotency key hit an existing ride. */
export async function createRide(
  input: CreateRideRequest,
): Promise<{ ride: CreatedRide; replayed: boolean }> {
  const { data, status } = await call<CreatedRide>('/rides', { method: 'POST', body: input });
  return { ride: data, replayed: status === 200 };
}

export interface RidePage {
  rides: RideListItem[];
  meta: { page: number; limit: number; total: number };
}

/** `GET /rides?status=&page=&limit=` — dashboard list and `/passenger/rides` share this. */
export async function fetchRides(params: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<RidePage> {
  const search = new URLSearchParams();
  if (params.status !== undefined && params.status !== '') search.set('status', params.status);
  search.set('page', String(params.page ?? 1));
  search.set('limit', String(params.limit ?? 20));

  const { data, meta } = await call<RideListItem[]>(`/rides?${search.toString()}`);
  return { rides: data, meta: meta ?? { page: 1, limit: data.length, total: data.length } };
}

/** `GET /rides/:id` — the polling target for the detail screen. */
export async function fetchRideDetail(rideId: string): Promise<RideDetail> {
  const { data } = await call<RideDetail>(`/rides/${encodeURIComponent(rideId)}`);
  return data;
}

/**
 * `POST /rides/:id/cancel` (api.md §5.4) — pre-start only. The API answers the
 * documented `409 RIDE_ALREADY_STARTED` / `409 ILLEGAL_STATE_TRANSITION`, which
 * `errors.ts` already maps to human copy.
 */
export async function cancelRide(rideId: string, reason?: string): Promise<CancelledRide> {
  const { data } = await call<CancelledRide>(`/rides/${encodeURIComponent(rideId)}/cancel`, {
    method: 'POST',
    body: reason === undefined ? {} : { reason },
  });
  return data;
}

/** `GET /rides/:id/payment` — a `404` until the pool completes (api.md §8). */
export async function fetchPayment(rideId: string): Promise<Payment> {
  const { data } = await call<Payment>(`/rides/${encodeURIComponent(rideId)}/payment`);
  return data;
}

/** `POST /rides/:id/payment/simulate` — idempotent `PENDING → PAID` (api.md §8). */
export async function simulatePayment(rideId: string): Promise<Payment> {
  const { data } = await call<Payment>(`/rides/${encodeURIComponent(rideId)}/payment/simulate`, {
    method: 'POST',
    body: {},
  });
  return data;
}

/* ---------------------------------------------------------------- driver ---- */

/** `GET /vehicles` — the caller's garage (api.md §7.1). */
export async function fetchVehicles(): Promise<VehicleSummary[]> {
  const { data } = await call<VehicleSummary[]>('/vehicles');
  return data;
}

export interface CreateVehicleInput {
  model: string;
  plate: string;
  seatCapacity: number;
}

/** `POST /vehicles` → `201`; a new car always starts `OFFLINE` (api.md §7.1). */
export async function createVehicle(input: CreateVehicleInput): Promise<VehicleSummary> {
  const { data } = await call<VehicleSummary>('/vehicles', { method: 'POST', body: input });
  return data;
}

/** `PATCH /vehicles/:id` — the online/offline toggle (api.md §7.2). */
export async function setVehicleStatus(
  vehicleId: string,
  status: 'ONLINE' | 'OFFLINE',
): Promise<VehicleStatusResponse> {
  const { data } = await call<VehicleStatusResponse>(`/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: 'PATCH',
    body: { status },
  });
  return data;
}

export interface DriverPoolPage {
  pools: DriverPoolListItem[];
  meta: { page: number; limit: number; total: number };
}

/**
 * `GET /driver/pools?status=` (api.md §6.1) — one endpoint serving all three
 * driver views: `?status=OPEN` is the Requests queue, the latest non-terminal
 * pool is the active trip, `?status=COMPLETED` is history (FR-HISTORY-002).
 */
export async function fetchDriverPools(
  params: {
    status?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<DriverPoolPage> {
  const search = new URLSearchParams();
  if (params.status !== undefined && params.status !== '') search.set('status', params.status);
  search.set('page', String(params.page ?? 1));
  search.set('limit', String(params.limit ?? 20));

  const { data, meta } = await call<DriverPoolListItem[]>(`/driver/pools?${search.toString()}`);
  return {
    pools: data,
    meta: meta ?? { page: 1, limit: data.length, total: data.length },
  };
}

/** `GET /driver/pools/:id` — roster, per-member fares and the pool timeline. */
export async function fetchDriverPool(poolId: string): Promise<DriverPoolDetail> {
  const { data } = await call<DriverPoolDetail>(`/driver/pools/${encodeURIComponent(poolId)}`);
  return data;
}

/** The five driver actions, named exactly as the routes name them (api.md §6.3–6.5). */
export type DriverAction = 'accept' | 'arrive' | 'start' | 'complete' | 'cancel';

/**
 * `POST /driver/pools/:id/{action}` — the trip progression plus the pre-start
 * cancel. The response is the pool *after* the transition with the roster
 * re-read in the same transaction, so the caller can render the new state
 * without a second round trip (and without guessing what the cascade did).
 */
export async function transitionPool(
  poolId: string,
  action: DriverAction,
): Promise<DriverTransitionResponse> {
  const { data } = await call<DriverTransitionResponse>(
    `/driver/pools/${encodeURIComponent(poolId)}/${action}`,
    { method: 'POST', body: {} },
  );
  return data;
}
