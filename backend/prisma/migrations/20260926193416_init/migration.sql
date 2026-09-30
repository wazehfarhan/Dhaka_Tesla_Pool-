-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PASSENGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FareStatus" AS ENUM ('ESTIMATED', 'FINAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "HistoryEntity" AS ENUM ('RIDE_REQUEST', 'POOL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "plate" VARCHAR(20) NOT NULL,
    "seat_capacity" SMALLINT NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'OFFLINE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(40) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_distances" (
    "zone_a" SMALLINT NOT NULL,
    "zone_b" SMALLINT NOT NULL,
    "distance_km" SMALLINT NOT NULL,

    CONSTRAINT "zone_distances_pkey" PRIMARY KEY ("zone_a","zone_b")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "jti_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "pickup_zone_id" SMALLINT NOT NULL,
    "destination_zone_id" SMALLINT NOT NULL,
    "status" "PoolStatus" NOT NULL DEFAULT 'OPEN',
    "seats_taken" SMALLINT NOT NULL DEFAULT 0,
    "seat_capacity" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_requests" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "pickup_zone_id" SMALLINT NOT NULL,
    "destination_zone_id" SMALLINT NOT NULL,
    "seats" SMALLINT NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
    "client_request_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_members" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "seats" SMALLINT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "pool_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fares" (
    "id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "status" "FareStatus" NOT NULL DEFAULT 'ESTIMATED',
    "distance_km" SMALLINT NOT NULL,
    "base_fare_poisha" INTEGER NOT NULL,
    "distance_charge_poisha" INTEGER NOT NULL,
    "subtotal_poisha" INTEGER NOT NULL,
    "pool_discount_poisha" INTEGER NOT NULL DEFAULT 0,
    "total_poisha" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(6),

    CONSTRAINT "fares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "amount_poisha" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" VARCHAR(16) NOT NULL DEFAULT 'SIMULATED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_status_history" (
    "id" UUID NOT NULL,
    "entity_type" "HistoryEntity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "changed_by" UUID,
    "reason" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE INDEX "vehicles_owner_id_idx" ON "vehicles"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_hash_key" ON "refresh_tokens"("jti_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "pools_status_pickup_zone_id_destination_zone_id_idx" ON "pools"("status", "pickup_zone_id", "destination_zone_id");

-- CreateIndex
CREATE INDEX "pools_driver_id_status_idx" ON "pools"("driver_id", "status");

-- CreateIndex
CREATE INDEX "ride_requests_passenger_id_status_idx" ON "ride_requests"("passenger_id", "status");

-- CreateIndex
CREATE INDEX "ride_requests_pool_id_idx" ON "ride_requests"("pool_id");

-- CreateIndex
CREATE INDEX "ride_requests_passenger_id_created_at_idx" ON "ride_requests"("passenger_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ride_requests_passenger_id_client_request_id_key" ON "ride_requests"("passenger_id", "client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "pool_members_ride_request_id_key" ON "pool_members"("ride_request_id");

-- CreateIndex
CREATE INDEX "pool_members_pool_id_status_idx" ON "pool_members"("pool_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fares_ride_request_id_key" ON "fares"("ride_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ride_request_id_key" ON "payments"("ride_request_id");

-- CreateIndex
CREATE INDEX "ride_status_history_entity_type_entity_id_created_at_idx" ON "ride_status_history"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_zone_a_fkey" FOREIGN KEY ("zone_a") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_zone_b_fkey" FOREIGN KEY ("zone_b") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_destination_zone_id_fkey" FOREIGN KEY ("destination_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_destination_zone_id_fkey" FOREIGN KEY ("destination_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fares" ADD CONSTRAINT "fares_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_status_history" ADD CONSTRAINT "ride_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Dhaka Tesla Pool — Integrity Constraints & Partial Indexes (database.md §9)
-- Added manually to initial migration: Prisma cannot express partial indexes
-- or raw CHECK constraints in schema.prisma.
-- ============================================================================

-- Vehicles: seat capacity must be between 1 and 8 (FR-POOL-004)
ALTER TABLE "vehicles"
  ADD CONSTRAINT "chk_vehicles_seat_capacity"
  CHECK ("seat_capacity" BETWEEN 1 AND 8);

-- Zone distances: zone_a < zone_b guarantees canonical unordered pair storage
ALTER TABLE "zone_distances"
  ADD CONSTRAINT "chk_zone_distances_ordering"
  CHECK ("zone_a" < "zone_b");

-- Zone distances: distance must be positive
ALTER TABLE "zone_distances"
  ADD CONSTRAINT "chk_zone_distances_positive"
  CHECK ("distance_km" > 0);

-- Pools: pickup and destination cannot be identical
ALTER TABLE "pools"
  ADD CONSTRAINT "chk_pools_distinct_zones"
  CHECK ("pickup_zone_id" <> "destination_zone_id");

-- Pools: seats_taken must be non-negative and never exceed vehicle capacity snapshot
ALTER TABLE "pools"
  ADD CONSTRAINT "chk_pools_seats_range"
  CHECK ("seats_taken" >= 0 AND "seats_taken" <= "seat_capacity");

-- Pools: seat_capacity snapshot must be at least 1
ALTER TABLE "pools"
  ADD CONSTRAINT "chk_pools_capacity_min"
  CHECK ("seat_capacity" >= 1);

-- Ride requests: pickup and destination cannot be identical
ALTER TABLE "ride_requests"
  ADD CONSTRAINT "chk_ride_requests_distinct_zones"
  CHECK ("pickup_zone_id" <> "destination_zone_id");

-- Ride requests: requested seats must be between 1 and 8
ALTER TABLE "ride_requests"
  ADD CONSTRAINT "chk_ride_requests_seats"
  CHECK ("seats" BETWEEN 1 AND 8);

-- Pool members: member seats must be at least 1
ALTER TABLE "pool_members"
  ADD CONSTRAINT "chk_pool_members_seats"
  CHECK ("seats" >= 1);

-- Fares: all monetary values must be non-negative integer poisha
ALTER TABLE "fares"
  ADD CONSTRAINT "chk_fares_base_fare" CHECK ("base_fare_poisha" >= 0),
  ADD CONSTRAINT "chk_fares_distance_charge" CHECK ("distance_charge_poisha" >= 0),
  ADD CONSTRAINT "chk_fares_subtotal" CHECK ("subtotal_poisha" >= 0),
  ADD CONSTRAINT "chk_fares_discount" CHECK ("pool_discount_poisha" >= 0),
  ADD CONSTRAINT "chk_fares_total" CHECK ("total_poisha" >= 0);

-- Payments: payment amount must be strictly positive integer poisha
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_amount_positive"
  CHECK ("amount_poisha" > 0);

-- Partial Unique Index: at most ONE open pool per vehicle per corridor (database.md §3.5)
CREATE UNIQUE INDEX "idx_unique_open_pool_per_corridor"
  ON "pools" ("vehicle_id", "pickup_zone_id", "destination_zone_id")
  WHERE ("status" = 'OPEN');

