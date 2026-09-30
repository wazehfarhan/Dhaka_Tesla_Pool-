# UI / UX Design — Dhaka Tesla Pool (MVP)

Companion documents: [PRD](PRD.md) · [requirements](requirements.md) · [api](api.md) · [testing](testing.md)

## 1. Principles

Clean, simple, responsive, accessible, easy to demo — nothing more. The UI is an honest control panel for the API: every screen maps to documented endpoints, every state in [requirements.md](requirements.md) has a visible representation, and no screen invents data the API did not return. Styling: Tailwind CSS, one accent colour, system font stack, generous whitespace. No design system, no storybook, no animation library.

## 2. Pages

| Route                     | Role      | Purpose                                                                                              |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `/`                       | any       | Redirect: passenger → `/passenger`, driver → `/driver`, guest → `/login`                             |
| `/login`                  | guest     | Email + password                                                                                     |
| `/register`               | guest     | Name, email, password, role selector (Passenger/Driver)                                              |
| `/passenger`              | passenger | Dashboard: active ride card or empty state + "Request ride" CTA                                      |
| `/passenger/request-ride` | passenger | Pickup → destination → seats → live fare estimate → submit                                           |
| `/passenger/rides`        | passenger | Ride history (paginated, status filter)                                                              |
| `/passenger/rides/:id`    | passenger | Ride detail: status timeline, pool members, fare breakdown, pay button                               |
| `/driver`                 | driver    | Dashboard: online/offline toggle, current trip card, next action button                              |
| `/driver/requests`        | driver    | Queue of `OPEN` pools waiting for acceptance (corridor, seats taken, estimate)                       |
| `/driver/pools/:id`       | driver    | Pool detail: passenger list, per-passenger fare, action buttons (Accept → Arrive → Start → Complete) |
| `/driver/history`         | driver    | Completed/cancelled pools with totals                                                                |

Middleware (Next.js) enforces role access: a passenger hitting `/driver/*` is redirected to `/passenger` **and** the API independently enforces `403` — the UI check is convenience, not security ([security.md](security.md) §4).

## 3. Passenger flow

```text
Login
  ↓
Dashboard (empty state)
  ↓
Request Ride → Select Pickup (zone dropdown)
            → Select Destination (zone dropdown, ≠ pickup)
            → Select Seats (1…capacity stepper)
            → View Fare (live estimate from POST /fare/estimate)
  ↓
[Request] → Waiting  (status REQUESTED — "Seats held. Finding your driver.")
  ↓                        (polls ride every 3 s)
Matched   (status ACCEPTED — "Jashim is on the way in Bullet.")
  ↓
Driver Arrived (status DRIVER_ARRIVED — "Jashim has arrived.")
  ↓
Started   (status STARTED — trip in progress; cancel button disabled)
  ↓
Completed (status COMPLETED — fare final, "Pay (simulated)" button → PAID)
```

Cancellation: a **Cancel** button is visible in `REQUESTED`, `ACCEPTED`, `DRIVER_ARRIVED` (confirmation dialog: "Nusrat's seat will be released"), hidden/disabled from `STARTED` on.

## 4. Driver flow

```text
Login
  ↓
Dashboard → Go Online (Bullet ONLINE)
  ↓
Requests / Pools   (OPEN pools: corridor · seats 2/3 · members · estimate)
  ↓
Accept          (OPEN → ACCEPTED; only enabled for Jashim's own pools)
  ↓
View Passengers (roster + individual fares on /driver/pools/:id)
  ↓
Arrive → Start → Complete    (each button rendered only when the state allows it)
  ↓
History (completed pools, totals)
```

Buttons are **state-derived, not role-derived**: the UI renders `Accept` only when `status === 'OPEN'`, `Complete` only when `status === 'STARTED'`, etc. The API re-validates every transition regardless ([architecture.md](architecture.md) §5) — a stale UI can produce a `409`, which the page surfaces as an inline error with a refresh action, never a silent failure.

## 5. UI states (every screen defines all seven)

| State            | Rule                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading**      | Skeleton blocks (no spinners-in-empty-pages); buttons show `…` and disable while their mutation is in flight (double-click prevention)                                                                                                                                           |
| **Empty**        | Dashboard: "No active ride — Request one" CTA / driver: "No open pools right now" — never a blank screen                                                                                                                                                                         |
| **Success**      | Toast/inline confirmation ("Ride requested — seats held"), status timeline updates on next poll                                                                                                                                                                                  |
| **Error**        | Inline, human copy mapped from API codes: `POOL_CAPACITY_EXCEEDED` → _"No seats left on this route — Bullet is full."_; `NO_VEHICLE_AVAILABLE` → _"The Tesla is offline right now."_; `ILLEGAL_STATE_TRANSITION` → _"This trip already moved on — refreshing…"_ (+ auto refetch) |
| **Disabled**     | Cancel hidden/disabled from `STARTED`; driver action buttons hidden unless the state matches; seat stepper capped at remaining capacity                                                                                                                                          |
| **Unauthorized** | Expired access token → silent refresh → retry; refresh fails → redirect to `/login` preserving `?next=`; wrong role on a route → redirect to own dashboard; API `403/404` never rendered as a raw status code                                                                    |
| **No seats**     | when `poolAvailableSeats = 0` the seat picker disables submit and shows the dedicated "Bullet is full on this route — try another route" panel; a `409 POOL_CAPACITY_EXCEEDED` that slips through a race renders the same panel (never a generic error)                          |

## 6. Key components

- `StatusTimeline` — vertical REQUESTED → … → COMPLETED with current step highlighted (reuse on passenger detail + driver pool detail).
- `FareCard` — `৳` display + poisha breakdown (`base + distance − pool discount`) + "assumes 2+ passengers" note.
- `ZonePicker` — select fed by `GET /zones`; blocks identical pickup/destination client-side.
- `SeatStepper` — `1…poolAvailableSeats` from `POST /fare/estimate` (never above remaining capacity), disabled values explained.
- `PoolRoster` (driver) — passenger, seats, status chip, individual fare.
- `PollIndicator` — subtle "live · updates every 3 s" dot; turns amber on poll failure, keeps last known state.

## 7. Live updates

No WebSockets (non-goal): active screens poll every **3 s** (`GET /rides/:id` / `GET /driver/pools/:id`) with backoff on failure, pausing when the tab is hidden (`visibilitychange`). This keeps the architecture at the brief's mandated shape and is entirely sufficient for a demo where a human clicks Accept seconds after requesting.

## 8. Responsive & accessibility basics

- Mobile-first single column (320 px+), dashboard cards stack; desktop adds a two-column dashboard (active ride | history). The demo is recorded at 1280×720 and must also work at 375 px.
- Semantic landmarks (`header`, `nav`, `main`), labelled form controls, visible focus rings, `aria-live="polite"` on status changes so screen readers announce "Driver arrived", contrast ≥ 4.5:1 for text, all actions reachable by keyboard.
- Currency always rendered `৳115.20` (never raw `11520`) with the integer available in the DOM `data-` attribute for the evaluator.
