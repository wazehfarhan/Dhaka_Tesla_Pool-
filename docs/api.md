# API Contract — Dhaka Tesla Pool (MVP)

Companion documents: [requirements](requirements.md) · [architecture](architecture.md) · [security](security.md) · [ui-ux.md](ui-ux.md) · [traceability](traceability.md)

## 1. Conventions

- **Style:** REST, JSON in / JSON out, mounted at **`/api/v1`**. Versioning: the `/v1` prefix is immutable; any breaking change (renamed field, changed semantics) gets `/v2` deployed alongside. Additive, backwards-compatible fields may be added freely within v1.
- **Auth:** access token sent as `Authorization: Bearer <jwt>` (stored in memory by the frontend); refresh token lives in an `httpOnly` cookie. Endpoints marked 🔓 are public.
- **Success:** `200`/`201` with the resource or `{ "success": true, "data": … }` for envelopes; `204` for deletes/no-content.
- **Error format (all errors, all endpoints):**

```json
{
  "success": false,
  "error": {
    "code": "POOL_CAPACITY_EXCEEDED",
    "message": "No available seats remain."
  }
}
```

`error.details` (optional) carries field-level validation info: `[{"field":"seats","message":"must be <= 3"}]`.

**Status codes:** `200` ok · `201` created · `204` no content · `400` VALIDATION_ERROR / SAME_ZONE / ZONE_NOT_FOUND · `401` UNAUTHENTICATED, INVALID_CREDENTIALS · `403` FORBIDDEN · `404` NOT_FOUND · `409` EMAIL_TAKEN, POOL_CAPACITY_EXCEEDED, ILLEGAL_STATE_TRANSITION, RIDE_ALREADY_STARTED, NO_VEHICLE_AVAILABLE, ACTIVE_RIDE_EXISTS, DUPLICATE_MEMBERSHIP · `429` RATE_LIMITED · `500` INTERNAL.

**Error codes registry (single source):** `VALIDATION_ERROR` · `SAME_ZONE` · `ZONE_NOT_FOUND` · `UNAUTHENTICATED` · `INVALID_CREDENTIALS` · `FORBIDDEN` · `NOT_FOUND` · `EMAIL_TAKEN` · `NO_VEHICLE_AVAILABLE` · `POOL_CAPACITY_EXCEEDED` · `DUPLICATE_MEMBERSHIP` · `ILLEGAL_STATE_TRANSITION` · `RIDE_ALREADY_STARTED` · `ACTIVE_RIDE_EXISTS` · `CONFLICT` · `RATE_LIMITED` · `INTERNAL`. Codes are defined once in `shared/errors.ts`, tested in `testing.md`, and reused by the frontend for user-facing copy. Two need a note: `ACTIVE_RIDE_EXISTS` = the caller already holds a ride in a non-terminal state (Assumption A-06); `DUPLICATE_MEMBERSHIP` = the partial-unique-index violation on the join path, surfaced only if the racing-retry itself fails (a "cannot happen" safety net that must still have a defined response).

- **Pagination:** query `?page=1&limit=20` (`limit` max 100). List responses are enveloped: `{"data":[…],"meta":{"page":1,"limit":20,"total":25}}`.
- **Ownership:** every `:id` resource is resolved **within the caller's scope** (own rides / own driver pools). A resource that exists but isn't the caller's returns **`404 NOT_FOUND`**, never `403`, to avoid ID probing (see [security.md](security.md) §4). Genuine role mismatches (passenger hitting `/driver/*`) return `403`.
- **Idempotency:** `POST /rides` accepts optional `clientRequestId` (UUID, header or body) unique per passenger — retries return the original ride (`200` instead of a second `201`). `POST …/payment/simulate` is naturally idempotent (repeat returns `PAID`). State transitions are *not* idempotent-friendly: repeating `accept` on an `ACCEPTED` pool returns `409 ILLEGAL_STATE_TRANSITION` so clients can detect ordering bugs.

## 2. Authentication — 🔓 public unless noted

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | 🔓 | Create account |
| POST | `/auth/login` | 🔓 | Get access token + refresh cookie |
| POST | `/auth/refresh` | 🔓 (cookie) | Rotate access token |
| POST | `/auth/refresh` | 🔓 (cookie) | Rotate access token |
| POST | `/auth/logout` | 🔓 (cookie) | Clear refresh token |
| GET | `/auth/me` | Bearer | Current profile |

**POST /api/v1/auth/register**

```json
// request
{ "name": "Nusrat", "email": "nusrat@example.com", "password": "secret1234", "role": "PASSENGER" }
// 201 response
{ "success": true, "data": { "id": "u_…", "name": "Nusrat", "email": "nusrat@example.com", "role": "PASSENGER" } }
```
Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`.

**POST /api/v1/auth/login** → `200` with `{data:{user:{…}, accessToken:"<jwt>"}}` + `Set-Cookie: refresh=…; HttpOnly; SameSite=Lax; Path=/api/v1/auth`. Errors: `401 INVALID_CREDENTIALS` (identical for unknown email and wrong password).

## 3. Zones — 🔓 public (dropdown data)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/zones` | 🔓 | List the 8 Dhaka zones |

`200` → `{"data":[{"id":1,"name":"Banani"},…]}`

## 4. Fare — 🔓 authenticated

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/fare/estimate` | Bearer | Pre-request fare estimate |

```json
// request
{ "pickupZone": "Banani", "destinationZone": "Dhanmondi", "seats": 1 }
// 200 response
{
  "success": true,
  "data": {
    "distanceKm": 7,
    "baseFarePoisha": 6000,
    "distanceChargePoisha": 8400,
    "subtotalPoisha": 14400,
    "poolDiscountPercent": 20,
    "estimatedDiscountPoisha": 2880,
    "perSeatPoisha": 11520,
    "totalDuePoisha": 11520,
    "currency": "BDT",
    "assumesPoolSize": 2,
    "seatCapacity": 3,
    "poolAvailableSeats": 2
  }
}
```

`assumesPoolSize: 2` makes the estimate honest: the 20% pool discount only applies if ≥ 2 members complete the trip (see [PRD](PRD.md) §12). `seatCapacity` is Bullet's fixed capacity and `poolAvailableSeats` is the remaining seats in the corridor's `OPEN` pool (`seatCapacity` when no pool exists yet) — the request form caps the seat picker with it so the UI never offers a seat that cannot be claimed; the server still re-checks atomically on `POST /rides` ([architecture](architecture.md) §7). Errors: `400 SAME_ZONE | ZONE_NOT_FOUND | VALIDATION_ERROR`.

## 5. Rides (passenger)

### 5.1 POST /api/v1/rides — request a ride (idempotent)

```json
// request
{ "pickupZone": "Banani", "destinationZone": "Dhanmondi", "seats": 1,
  "clientRequestId": "8f14e45f-ceea-467f-a1d2-91b60cf1f8f3" }
// 201 response
{ "success": true, "data": {
    "id": "r_…", "status": "REQUESTED", "poolId": "p_…", "seats": 1,
    "pickupZone": "Banani", "destinationZone": "Dhanmondi", "distanceKm": 7,
    "estimate": { "perSeatPoisha": 11520, "totalDuePoisha": 11520, "currency": "BDT" },
    "createdAt": "…" } }
```

Flow (server-side, one transaction): validate → match/create pool → atomic seat claim → persist request + member + fare estimate ([architecture.md](architecture.md) §6).

Errors: `400 VALIDATION_ERROR | SAME_ZONE | ZONE_NOT_FOUND` · `403` (driver) · `409 NO_VEHICLE_AVAILABLE | POOL_CAPACITY_EXCEEDED | ACTIVE_RIDE_EXISTS` (caller already has an active ride, Assumption A-06).

**Idempotency:** replaying the same `clientRequestId` returns the original ride with `200` and does not create a second one (DB unique pair).

### 5.2 GET /api/v1/rides — list mine (history)

Query: `?status=COMPLETED&page=1&limit=20` (any enum status, or none). → `200 {data:[…], meta:{page,limit,total}}`. Only the caller's rides; this endpoint serves both the live dashboard list and `/passenger/rides` history (FR-HISTORY-001).

### 5.3 GET /api/v1/rides/:id — ride detail

`200` → ride + pool summary (corridor, status, `seatsTaken/seatCapacity`, member count), status timeline (from `ride_status_history`), fare (`ESTIMATED`/`FINAL`), payment status. Foreign or unknown ID → `404 NOT_FOUND`.

### 5.4 POST /api/v1/rides/:id/cancel — cancel own ride

Body: `{ "reason": "optional text" }`. Allowed while `status ∈ {REQUESTED, ACCEPTED, DRIVER_ARRIVED}`. → `200` with cancelled ride. Errors: `404` (foreign), `409 RIDE_ALREADY_STARTED`, `409 ILLEGAL_STATE_TRANSITION` (already `COMPLETED`/`CANCELLED`).

## 6. Driver & Pools

All driver endpoints require role `DRIVER`; pool IDs outside the driver's own vehicle return `404`.

### 6.1 GET /api/v1/driver/pools — driver's pools (history lives here too)

Query: `?status=OPEN|ACCEPTED|…|COMPLETED&page&limit`. Default: all own pools, newest first. This single endpoint serves the **Requests queue** (`?status=OPEN`), the **active trip** (latest non-terminal), and **driver history** (`?status=COMPLETED`) — FR-HISTORY-002.

`200` → `{"data":[{"id":"p_…","status":"OPEN","pickupZone":"Banani","destinationZone":"Dhanmondi","distanceKm":7,"seatsTaken":2,"seatCapacity":3,"members":[{"passenger":"Nusrat","seats":1,"status":"REQUESTED"}]}],"meta":{…}}`

### 6.2 GET /api/v1/driver/pools/:id — pool detail

Pool + full roster (passenger, seats, per-member ride status, per-member `FINAL`/`ESTIMATED` fare, payment status) + pool timeline from `ride_status_history`. Foreign pool → `404`.

### 6.3 POST /api/v1/driver/pools/:id/accept

`200` → pool `ACCEPTED` + `data.members[]` all `ACCEPTED`.
Errors: `404` (foreign/unknown) · `409 ILLEGAL_STATE_TRANSITION` with `details: {current:"OPEN", expected:"…"}` — repeating accept on an `ACCEPTED` pool fails loudly (§1 idempotency note).

### 6.4 POST /api/v1/driver/pools/:id/arrive · /start · /complete

Same shape; guards: `ACCEPTED → DRIVER_ARRIVED`, `DRIVER_ARRIVED → STARTED`, `STARTED → COMPLETED`.

`complete` additionally finalizes every active member's fare (pool discount iff ≥ 2 active members) and creates `PENDING` payments — all in one transaction:

```json
// 200 response of POST /driver/pools/p_…/complete
{ "success": true, "data": {
    "id": "p_…", "status": "COMPLETED",
    "members": [
      { "rideId": "r_nusrat", "passenger": "Nusrat", "status": "COMPLETED",
        "fare": { "subtotalPoisha": 14400, "poolDiscountPoisha": 2880, "totalPoisha": 11520 },
        "payment": { "status": "PENDING", "amountPoisha": 11520 } },
      { "rideId": "r_rafiq", "passenger": "Rafiq", "status": "COMPLETED",
        "fare": { "subtotalPoisha": 14400, "poolDiscountPoisha": 2880, "totalPoisha": 11520 },
        "payment": { "status": "PENDING", "amountPoisha": 11520 } }
    ] } }
```

### 6.5 POST /api/v1/driver/pools/:id/cancel (pre-start only)

Driver cancels a pool before `STARTED` → pool + all active rides `CANCELLED`. After `STARTED` → `409 RIDE_ALREADY_STARTED`.

## 7. Vehicles

### 7.1 GET /api/v1/vehicles · POST /api/v1/vehicles

- `GET /vehicles` (driver) → own vehicles: `[{id, model, plate, seatCapacity, status}]`. Passengers don't query vehicles directly (their UI gets capacity via zones/estimate endpoints; the request form caps seats client-side from `/fare/estimate` + server validation).
- `POST /vehicles` `{model, plate, seatCapacity}` → `201`. Errors: `400 VALIDATION_ERROR` (capacity outside 1…8), `409` duplicate plate.

### 7.2 PATCH /api/v1/vehicles/:id

Body: `{ "status": "ONLINE" | "OFFLINE" }` → `200 {data:{id,status}}`.
Errors: `404` (not the caller's vehicle), `400 VALIDATION_ERROR`. Effect: `ONLINE` is required for **new** ride requests to be creatable (`NO_VEHICLE_AVAILABLE` otherwise); it does not cancel or block existing pools.

## 8. Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/rides/:id/payment` | Bearer (owner) | Current payment (or `404` if ride not completed yet) |
| POST | `/rides/:id/payment/simulate` | Bearer (owner) | `PENDING → PAID` (idempotent) |

```json
// 200 response (both first and repeated call)
{ "success": true, "data": { "id": "pay_…", "rideId": "r_…", "amountPoisha": 11520,
  "currency": "BDT", "status": "PAID", "method": "SIMULATED", "paidAt": "…" } }
```
Errors: `404` (foreign/unknown ride), `409 ILLEGAL_STATE_TRANSITION` (ride not `COMPLETED` or payment not `PENDING`-or-already-`PAID` edge cases handled by returning `PAID`).

## 9. Health (public)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | 🔓 | Liveness: `200 {"status":"ok"}` — no DB call |
| GET | `/health/ready` | 🔓 | Readiness: `200` if `SELECT 1` succeeds, else `503` |

Used by Docker healthchecks, Compose `depends_on: condition: service_healthy`, and cloud host probes ([deployment.md](deployment.md)).

## 10. Endpoint summary (quick reference)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | 🔓 | auth lifecycle |
| GET | `/auth/me` | any | current profile |
| GET | `/zones` | 🔓 | zone list |
| POST | `/fare/estimate` | PASSENGER | pre-request fare |
| POST | `/rides` | PASSENGER | request ride (idempotent) |
| GET | `/rides` · `/rides/:id` | PASSENGER | list/history + detail |
| POST | `/rides/:id/cancel` | PASSENGER | cancel own (pre-start) |
| GET | `/rides/:id/payment` · POST `/rides/:id/payment/simulate` | PASSENGER | simulated payment |
| GET | `/driver/pools` (+`?status=`) · `/driver/pools/:id` | DRIVER | queue, detail, history |
| POST | `/driver/pools/:id/accept` · `/arrive` · `/start` · `/complete` · `/cancel` | DRIVER | trip progression |
| GET/POST | `/vehicles` · PATCH `/vehicles/:id` | DRIVER | Tesla registry + online toggle |
| GET | `/health` · `/health/ready` | 🔓 | probes |

Every row above maps to concrete tests in [testing.md](testing.md) and requirements in [requirements.md](requirements.md) (see the [matrix](traceability.md)).