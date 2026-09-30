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
import { clearRoleCookie } from './cookies';
import { clearAccessToken, getAccessToken, setAccessToken } from './token-store';
import type {
  ApiEnvelope,
  ApiErrorBody,
  CreatedRide,
  CreateRideRequest,
  FareEstimate,
  RideDetail,
  RideListItem,
  UserProfile,
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

/** Single-flight refresh — all racing 401s await the same rotation. */
let refreshInFlight: Promise<boolean> | null = null;

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
 * `POST /auth/refresh` — the one call that may run without a token. Returns
 * whether a new access token was obtained; on failure the session is cleared so
 * the guards send the user to `/login`.
 */
export async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        clearAccessToken();
        clearRoleCookie();
        return false;
      }
      const envelope = (await parseBody(response)) as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(envelope.data.accessToken);
      return true;
    } catch {
      clearAccessToken();
      clearRoleCookie();
      return false;
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
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        response = await send();
      } catch {
        throw new NetworkError();
      }
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
    clearAccessToken();
    clearRoleCookie();
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
