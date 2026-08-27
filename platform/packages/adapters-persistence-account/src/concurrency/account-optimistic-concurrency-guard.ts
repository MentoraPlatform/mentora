import { Prisma } from '../generated/prisma/client.js';

/**
 * The optimistic guard of the Account registries — NOT a lock: a comparison
 * (F5.2 §4). JUSTIFIED DIVERGENCE from the Credential guard (Domain
 * Checklist §I): this context's VERSION LAW is +1 per act, fact or not
 * (device and support verbs publish nothing), so the expected previous
 * version is `version − unretainedActs` — the delta the units carry for
 * exactly this purpose — never `version − pendingFacts.length`.
 *
 * classifyEngineError sorts collisions into their lawful channels:
 * - the R-A partial unique index (one ACTIVE subscription per holder) →
 *   structural Refusal `SubscriptionAlreadyExists`;
 * - a photograph primary-key collision (birth on an inhabited identity) →
 *   structural Refusal (R-B);
 * - everything else → engine Failure (R-10, rethrown).
 */

export const RA_SUBSCRIPTION_INDEX = 'subscription_active_holder_ra_key';

export const previousVersionOf = (unit: {
  readonly version: number;
  readonly unretainedActs: number;
}): number => unit.version - unit.unretainedActs;

export type EngineCollision = 'ra-key' | 'duplicate-identity' | 'engine';

export const classifyEngineError = (error: unknown): EngineCollision => {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? '')}`
      : String(error);
  if (text.includes(RA_SUBSCRIPTION_INDEX)) {
    return 'ra-key';
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    // Prisma reports a partial-unique-index violation as P2002 with the
    // COLUMNS as target (never the index name — probed on the real
    // engine): on SubscriptionSnapshot, target ["personId"] IS the R-A
    // key; the pkey collision targets the unit's own identifier — R-B.
    const meta = error.meta as { modelName?: string; target?: readonly string[] } | undefined;
    if (meta?.modelName === 'SubscriptionSnapshot' && (meta.target ?? []).includes('personId')) {
      return 'ra-key';
    }
    return 'duplicate-identity';
  }
  if (text.includes('Snapshot_pkey')) {
    return 'duplicate-identity';
  }
  return 'engine';
};
