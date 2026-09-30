#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# End-to-end smoke test against a running stack (deployment.md §1, PRD §7 demo).
#
#   docker compose up -d --build
#   ./scripts/smoke.sh                       # uses http://localhost:4000
#   API_URL=… ./scripts/smoke.sh             # against a deployed API
#
# It drives the documented demo with curl and asserts the values the docs
# promise — the ৳115.20 fare (11520 poisha) for Banani → Dhanmondi, two
# passengers on one pool, the PENDING → PAID payment, and the one-seat race.
# No mocks and no jq: each check greps the response body, and a mismatch exits
# non-zero with the body printed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

API="${API_URL:-http://localhost:4000}/api/v1"
# A per-run stamp keeps the script re-runnable against a stack that already
# holds earlier runs' data: emails must be unique, and the plate is UNIQUE
# fleet-wide (api.md §7.1), so a fixed one would answer 409 the second time.
STAMP="$(date +%H%M%S)$((RANDOM % 1000))"
PLATE="DHK-SMOKE-$STAMP"
PASS=0

json() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([^,}]*\).*/\1/p" | head -1 | tr -d '"'; }

check() { # check <label> <haystack> <needle>
  if printf '%s' "$2" | grep -q "$3"; then
    printf '  ✓ %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %s\n    expected: %s\n    in: %s\n' "$1" "$3" "$2"
    exit 1
  fi
}

api() { # api <method> <path> [token] [body]
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  if [ -n "$token" ]; then
    curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' ${body:+-d "$body"}
  else
    curl -sS -X "$method" "$API$path" -H 'Content-Type: application/json' ${body:+-d "$body"}
  fi
}

# register <name> <email-prefix> <role> → "<token> <userId>"
register() {
  local name="$1" email="$2-$STAMP@example.com" role="$3"
  local response
  response="$(api POST /auth/register '' "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"demo1234\",\"role\":\"$role\"}")"
  # The auth limiter is 10 requests/minute/IP (security.md §5) and this script
  # registers more than ten people, so a stock stack will throttle us. That is
  # correct behaviour, not a bug: wait out the window and carry on, exactly as a
  # real user would. Set RATE_LIMIT_MAX_AUTH higher to skip the pause.
  if printf '%s' "$response" | grep -q RATE_LIMITED; then
    # stderr, never stdout: this function's stdout *is* the token the caller
    # captures, and a notice printed there would corrupt the Bearer header.
    printf '  … auth rate limit reached (10/min, security.md §5) — waiting 61s\n' >&2
    sleep 61
    response="$(api POST /auth/register '' "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"demo1234\",\"role\":\"$role\"}")"
  fi
  api POST /auth/login '' "{\"email\":\"$email\",\"password\":\"demo1234\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
}

printf '\n0. Health (api.md §9)\n'
check 'GET /health is ok' "$(api GET /health)" '"status":"ok"'

printf '\n1. Register the cast (api.md §2)\n'
JASHIM_TOKEN="$(register Jashim jashim DRIVER)"
NUSRAT_TOKEN="$(register Nusrat nusrat PASSENGER)"
RAFIQ_TOKEN="$(register Rafiq rafiq PASSENGER)"
SHIRIN_TOKEN="$(register Shirin shirin PASSENGER)"
check 'the driver holds a token' "$JASHIM_TOKEN" '.'

printf '\n2. Vehicle registry (api.md §7)\n'
VEHICLE="$(api POST /vehicles "$JASHIM_TOKEN" "{\"model\":\"Tesla Model 3\",\"plate\":\"$PLATE\",\"seatCapacity\":3}")"
VEHICLE_ID="$(json "$VEHICLE" id)"
check 'a new vehicle starts OFFLINE' "$VEHICLE" '"status":"OFFLINE"'

# A ride before going online must be refused (NO_VEHICLE_AVAILABLE, api.md §5.1).
# This only holds on a *pristine* database: matching picks any ONLINE vehicle, so
# if an earlier run left one online the request legitimately succeeds — which is
# why it runs as a throwaway passenger (a real ride would then block their next
# request with ACTIVE_RIDE_EXISTS). The refusal itself is covered
# deterministically by the integration suite; `docker compose down -v` starts
# from scratch.
PROBE_TOKEN="$(register Probe probe PASSENGER)"
EARLY="$(api POST /rides "$PROBE_TOKEN" '{"pickupZone":"Banani","destinationZone":"Dhanmondi","seats":1}')"
if printf '%s' "$EARLY" | grep -q NO_VEHICLE_AVAILABLE; then
  check 'a ride is refused while the car is offline' "$EARLY" 'NO_VEHICLE_AVAILABLE'
else
  printf '  – skipped: another ONLINE car already exists on this database\n' >&2
fi
check 'car goes ONLINE' "$(api PATCH "/vehicles/$VEHICLE_ID" "$JASHIM_TOKEN" '{"status":"ONLINE"}')" '"status":"ONLINE"'

printf '\n3. Pooling (api.md §5)\n'
check 'the estimate is 11520 poisha (৳115.20)' "$(api POST /fare/estimate "$NUSRAT_TOKEN" '{"pickupZone":"Banani","destinationZone":"Dhanmondi","seats":1}')" '"perSeatPoisha":11520'

# Preflight: the demo corridor needs an open seat. This is a *fresh-database*
# smoke test by design (CI gets a clean volume every run); leftover demo rows from
# an earlier run would otherwise surface as a confusing 409 halfway through, so
# they are detected here and reported as what they are.
PREFLIGHT_TOKEN="$(register Preflight preflight PASSENGER)"
PREFLIGHT_RIDE="$(api POST /rides "$PREFLIGHT_TOKEN" '{"pickupZone":"Banani","destinationZone":"Dhanmondi","seats":1}')"
if printf '%s' "$PREFLIGHT_RIDE" | grep -q POOL_CAPACITY_EXCEEDED; then
  printf '\n  ✗ the Banani → Dhanmondi pool is already full from an earlier run.\n' >&2
  printf '    This script assumes a fresh database. Reset with:\n' >&2
  printf '      docker compose down -v && docker compose up -d --build\n' >&2
  exit 1
fi
# Hand the probe's seat straight back so it cannot skew the demo numbers.
api POST "/rides/$(json "$PREFLIGHT_RIDE" id)/cancel" "$PREFLIGHT_TOKEN" >/dev/null

NUSRAT_RIDE="$(api POST /rides "$NUSRAT_TOKEN" '{"pickupZone":"Banani","destinationZone":"Dhanmondi","seats":1}')"
POOL_ID="$(json "$NUSRAT_RIDE" poolId)"
NUSRAT_RIDE_ID="$(json "$NUSRAT_RIDE" id)"
check 'the ride is REQUESTED' "$NUSRAT_RIDE" '"status":"REQUESTED"'
RAFIQ_RIDE="$(api POST /rides "$RAFIQ_TOKEN" '{"pickupZone":"Banani","destinationZone":"Dhanmondi","seats":1}')"
check 'the second passenger joins the SAME pool' "$RAFIQ_RIDE" "\"poolId\":\"$POOL_ID\""
check 'the driver queue shows 2 of 3 seats' "$(api GET '/driver/pools?status=OPEN' "$JASHIM_TOKEN")" '"seatsTaken":2'

printf '\n4. Trip progression (api.md §6)\n'
check 'accept'   "$(api POST "/driver/pools/$POOL_ID/accept"  "$JASHIM_TOKEN")" '"status":"ACCEPTED"'
check 'arrive'   "$(api POST "/driver/pools/$POOL_ID/arrive"  "$JASHIM_TOKEN")" '"status":"DRIVER_ARRIVED"'
check 'start'    "$(api POST "/driver/pools/$POOL_ID/start"   "$JASHIM_TOKEN")" '"status":"STARTED"'
COMPLETED="$(api POST "/driver/pools/$POOL_ID/complete" "$JASHIM_TOKEN")"
check 'complete' "$COMPLETED" '"status":"COMPLETED"'
check 'the final fare carries the 2880 pool discount' "$COMPLETED" '"poolDiscountPoisha":2880'
check 'a PENDING payment exists per member' "$COMPLETED" '"status":"PENDING"'
check 'a repeat accept is refused' "$(api POST "/driver/pools/$POOL_ID/accept" "$JASHIM_TOKEN")" 'ILLEGAL_STATE_TRANSITION'

printf '\n5. Payment (api.md §8)\n'
check 'the payment settles' "$(api POST "/rides/$NUSRAT_RIDE_ID/payment/simulate" "$NUSRAT_TOKEN")" '"status":"PAID"'
check 'paying twice is idempotent' "$(api POST "/rides/$NUSRAT_RIDE_ID/payment/simulate" "$NUSRAT_TOKEN")" '"status":"PAID"'

printf '\n6. The last-seat race (testing.md §6, Goal G2)\n'
# A second corridor with exactly **one seat free**: one passenger holds 2 of
# Bullet's 3 seats, and two fresh claimants race for the third. Fresh users
# matter — `ACTIVE_RIDE_EXISTS` (api.md §5.1) would otherwise fire first and the
# race would prove nothing.
FILLER_TOKEN="$(register Mehjabin mehjabin PASSENGER)"
RACER_ONE_TOKEN="$(register Shirin shirin PASSENGER)"
RACER_TWO_TOKEN="$(register Kamal kamal PASSENGER)"

api POST /rides "$FILLER_TOKEN" '{"pickupZone":"Gulshan","destinationZone":"Bashundhara","seats":2}' >/dev/null
check 'the corridor pool holds 2 of 3 seats — exactly one free' \
  "$(api GET '/driver/pools?status=OPEN' "$JASHIM_TOKEN")" '"seatsTaken":2'

# Both launched with `&` in the same shell tick: one 201, one 409.
( api POST /rides "$RACER_ONE_TOKEN" '{"pickupZone":"Gulshan","destinationZone":"Bashundhara","seats":1}' > /tmp/smoke-a.json ) &
A=$!
( api POST /rides "$RACER_TWO_TOKEN" '{"pickupZone":"Gulshan","destinationZone":"Bashundhara","seats":1}' > /tmp/smoke-b.json ) &
B=$!
wait $A $B
BOTH="$(cat /tmp/smoke-a.json /tmp/smoke-b.json)"
WINNERS=$(printf '%s' "$BOTH" | grep -o '"status":"REQUESTED"' | wc -l | tr -d ' ')
LOSERS=$(printf '%s' "$BOTH" | grep -o 'POOL_CAPACITY_EXCEEDED' | wc -l | tr -d ' ')
check 'exactly one claimant wins the last seat' "$WINNERS" '1'
check 'exactly one claimant is refused' "$LOSERS" '1'
check 'the pool never overbooks (still 3 of 3)' \
  "$(api GET '/driver/pools?status=OPEN' "$JASHIM_TOKEN")" '"seatsTaken":3'

printf '\n%s\n' "Smoke test passed — $PASS checks green."
