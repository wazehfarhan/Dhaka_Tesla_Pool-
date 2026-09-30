/**
 * Idempotent seed — safe to run as many times as you like (deployment.md §1).
 *
 * - Reference data (zones + 28 integer-km distances) is seeded in every environment.
 * - The demo cast and Bullet are seeded only outside production (NODE_ENV=production seeds
 *   reference data only, so no default passwords can ever reach a deployed database).
 * - Nothing is ever overwritten: existing rows keep their state (e.g. Jashim staying ONLINE
 *   after a re-seed).
 *
 * Story cast and numbers are fixed by PRD §2/§12 and testing.md §8 — Jashim, Bullet (3 seats),
 * Nusrat, Rafiq, Shirin (+ Mehjabin, who exists only for the concurrency fixture).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { loadDotEnv } from '../src/config/load-env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const ZONES = [
  'Banani',
  'Gulshan',
  'Mohakhali',
  'Dhanmondi',
  'Mirpur',
  'Uttara',
  'Farmgate',
  'Bashundhara',
] as const;

/** Integer kilometres (PRD §10, ADR-004). Banani ↔ Dhanmondi = 7 km drives the demo fare. */
const DISTANCES: ReadonlyArray<readonly [string, string, number]> = [
  ['Banani', 'Gulshan', 4],
  ['Banani', 'Mohakhali', 5],
  ['Banani', 'Dhanmondi', 7],
  ['Banani', 'Mirpur', 9],
  ['Banani', 'Uttara', 14],
  ['Banani', 'Farmgate', 6],
  ['Banani', 'Bashundhara', 8],
  ['Gulshan', 'Mohakhali', 4],
  ['Gulshan', 'Dhanmondi', 6],
  ['Gulshan', 'Mirpur', 11],
  ['Gulshan', 'Uttara', 15],
  ['Gulshan', 'Farmgate', 8],
  ['Gulshan', 'Bashundhara', 5],
  ['Mohakhali', 'Dhanmondi', 5],
  ['Mohakhali', 'Mirpur', 8],
  ['Mohakhali', 'Uttara', 13],
  ['Mohakhali', 'Farmgate', 5],
  ['Mohakhali', 'Bashundhara', 9],
  ['Dhanmondi', 'Mirpur', 8],
  ['Dhanmondi', 'Uttara', 16],
  ['Dhanmondi', 'Farmgate', 5],
  ['Dhanmondi', 'Bashundhara', 10],
  ['Mirpur', 'Uttara', 9],
  ['Mirpur', 'Farmgate', 7],
  ['Mirpur', 'Bashundhara', 14],
  ['Uttara', 'Farmgate', 12],
  ['Uttara', 'Bashundhara', 17],
  ['Farmgate', 'Bashundhara', 12],
];

/** Development/test password only — documented in the README, never used in production. */
const DEMO_PASSWORD = 'demo1234';

const DEMO_USERS: ReadonlyArray<{ name: string; email: string; role: 'DRIVER' | 'PASSENGER' }> = [
  { name: 'Jashim', email: 'jashim@example.com', role: 'DRIVER' },
  { name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' },
  { name: 'Rafiq', email: 'rafiq@example.com', role: 'PASSENGER' },
  { name: 'Shirin', email: 'shirin@example.com', role: 'PASSENGER' },
  { name: 'Mehjabin', email: 'mehjabin@example.com', role: 'PASSENGER' },
];

/** Bullet: the one Tesla (Decision D-02 — capacity confirmed before Phase 2 was written). */
const VEHICLE = { model: 'Tesla Model 3', plate: 'DHK-TSL-001', seatCapacity: 3 } as const;

async function seed(): Promise<void> {
  loadDotEnv();
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the seed script.');
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Zones (idempotent upsert by name)
    const zoneMap = new Map<string, number>();
    for (const name of ZONES) {
      const zone = await prisma.zone.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      zoneMap.set(zone.name, zone.id);
    }

    // 2. Zone distances (canonical: zoneA < zoneB)
    for (const [zoneAName, zoneBName, distanceKm] of DISTANCES) {
      const idA = zoneMap.get(zoneAName)!;
      const idB = zoneMap.get(zoneBName)!;
      const [zoneA, zoneB] = idA < idB ? [idA, idB] : [idB, idA];

      await prisma.zoneDistance.upsert({
        where: { zoneA_zoneB: { zoneA, zoneB } },
        update: { distanceKm },
        create: { zoneA, zoneB, distanceKm },
      });
    }

    // 3. Demo cast & vehicle (only seeded outside production)
    const isProduction = process.env['NODE_ENV'] === 'production';
    if (isProduction) {
      console.log('Production environment detected: seeded reference zones & distances only.');
      return;
    }

    const passwordHash = await hash(DEMO_PASSWORD, 10);
    const userMap = new Map<string, string>();

    for (const demoUser of DEMO_USERS) {
      const user = await prisma.user.upsert({
        where: { email: demoUser.email },
        update: {},
        create: {
          name: demoUser.name,
          email: demoUser.email,
          passwordHash,
          role: demoUser.role,
        },
      });
      userMap.set(user.name, user.id);
    }

    // Jashim's vehicle: Bullet
    const jashimId = userMap.get('Jashim');
    if (jashimId) {
      await prisma.vehicle.upsert({
        where: { plate: VEHICLE.plate },
        update: {},
        create: {
          ownerId: jashimId,
          model: VEHICLE.model,
          plate: VEHICLE.plate,
          seatCapacity: VEHICLE.seatCapacity,
          status: 'OFFLINE',
        },
      });
    }

    console.log('Seed completed successfully (zones, distances, demo users, Bullet).');
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

