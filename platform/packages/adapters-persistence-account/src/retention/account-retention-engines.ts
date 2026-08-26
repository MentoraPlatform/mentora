import type {
  Account,
  AvailabilityFrame,
  Subscription,
  SupportRequest,
} from '@mentora/domain-account';
import type { RetentionContext } from '@mentora/kernel';

import { previousVersionOf } from '../concurrency/account-optimistic-concurrency-guard.js';
import { AccountVersionConflictError } from '../errors/account-persistence-errors.js';
import type { AccountFactStreamStore } from '../fact-stream/account-fact-stream-store.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AccountOutboxStore } from '../outbox/account-outbox-store.js';
import {
  toAccountRow,
  toAvailabilityFrameRow,
  toSubscriptionRow,
  toSupportRequestRow,
} from '../snapshot/account-snapshot-mappers.js';

/**
 * The four retention engines — the atomic act (pas 8), EXACTLY the
 * Blueprint order: (1) version control → (2) fact-stream append →
 * (3) photograph → (4) Outbox de faits → (5) commit (the caller's
 * transaction). The retention talks to NO ONE (A-3). Every collision
 * THROWS; classification into lawful channels happens OUTSIDE the aborted
 * transaction (the facade, after rollback) — nothing partial ever exists.
 *
 * JUSTIFIED DIVERGENCE (Domain Checklist §I): the version law of this
 * context is +1 per act — the expected previous version is
 * `version − unretainedActs` (see the concurrency guard), and a retention
 * MAY carry zero facts (device verbs): steps (2) and (4) are then empty
 * writes, the version still advances. SupportRequest's engine has NO fact
 * and NO outbox step — structurally absent (precedent: Session engine).
 */

const versionControl = async (
  read: () => Promise<{ version: number } | null>,
  subject: string,
  previousVersion: number,
): Promise<void> => {
  if (previousVersion > 0) {
    const current = await read();
    if (current === null || current.version !== previousVersion) {
      throw new AccountVersionConflictError(subject, previousVersion);
    }
  }
};

export class AccountRetentionEngine {
  constructor(
    private readonly factStream: AccountFactStreamStore,
    private readonly outbox: AccountOutboxStore,
  ) {}

  async retainWithin(
    tx: Prisma.TransactionClient,
    unit: Account,
    context?: RetentionContext,
  ): Promise<void> {
    const row = toAccountRow(unit);
    const previousVersion = previousVersionOf(unit);
    await versionControl(
      () =>
        tx.accountSnapshot.findUnique({
          where: { personId: row.personId },
          select: { version: true },
        }),
      row.personId,
      previousVersion,
    );
    await this.factStream.append(tx, unit.pendingFacts);
    if (previousVersion === 0) {
      await tx.accountSnapshot.create({ data: row });
    } else {
      const updated = await tx.accountSnapshot.updateMany({
        where: { personId: row.personId, version: previousVersion },
        data: { ...row },
      });
      if (updated.count === 0) {
        throw new AccountVersionConflictError(row.personId, previousVersion);
      }
    }
    await this.outbox.write(tx, unit.pendingFacts, context);
  }
}

export class AvailabilityFrameRetentionEngine {
  constructor(
    private readonly factStream: AccountFactStreamStore,
    private readonly outbox: AccountOutboxStore,
  ) {}

  async retainWithin(
    tx: Prisma.TransactionClient,
    unit: AvailabilityFrame,
    context?: RetentionContext,
  ): Promise<void> {
    const row = toAvailabilityFrameRow(unit);
    const previousVersion = previousVersionOf(unit);
    await versionControl(
      () =>
        tx.availabilityFrameSnapshot.findUnique({
          where: { personId: row.personId },
          select: { version: true },
        }),
      row.personId,
      previousVersion,
    );
    await this.factStream.append(tx, unit.pendingFacts);
    if (previousVersion === 0) {
      await tx.availabilityFrameSnapshot.create({ data: row });
    } else {
      const updated = await tx.availabilityFrameSnapshot.updateMany({
        where: { personId: row.personId, version: previousVersion },
        data: { ...row },
      });
      if (updated.count === 0) {
        throw new AccountVersionConflictError(row.personId, previousVersion);
      }
    }
    await this.outbox.write(tx, unit.pendingFacts, context);
  }
}

export class SubscriptionRetentionEngine {
  constructor(
    private readonly factStream: AccountFactStreamStore,
    private readonly outbox: AccountOutboxStore,
  ) {}

  async retainWithin(
    tx: Prisma.TransactionClient,
    unit: Subscription,
    context?: RetentionContext,
  ): Promise<void> {
    const row = toSubscriptionRow(unit);
    const previousVersion = previousVersionOf(unit);
    await versionControl(
      () =>
        tx.subscriptionSnapshot.findUnique({
          where: { subscriptionId: row.subscriptionId },
          select: { version: true },
        }),
      row.subscriptionId,
      previousVersion,
    );
    await this.factStream.append(tx, unit.pendingFacts);
    // The photograph write is where the R-A partial unique index bites
    // (one ACTIVE subscription per holder) — the constraint aborts the
    // transaction and the facade classifies it as SubscriptionAlreadyExists.
    if (previousVersion === 0) {
      await tx.subscriptionSnapshot.create({ data: row });
    } else {
      const updated = await tx.subscriptionSnapshot.updateMany({
        where: { subscriptionId: row.subscriptionId, version: previousVersion },
        data: { ...row },
      });
      if (updated.count === 0) {
        throw new AccountVersionConflictError(row.subscriptionId, previousVersion);
      }
    }
    await this.outbox.write(tx, unit.pendingFacts, context);
  }
}

/**
 * STATE ONLY — no fact step, no outbox step: not skipped, STRUCTURALLY
 * ABSENT (the unit has no pendingFacts field, the schema has no
 * SupportRequest fact tables; what has no code path cannot leak).
 */
export class SupportRequestRetentionEngine {
  async retainWithin(tx: Prisma.TransactionClient, unit: SupportRequest): Promise<void> {
    const row = toSupportRequestRow(unit);
    const previousVersion = previousVersionOf(unit);
    await versionControl(
      () =>
        tx.supportRequestSnapshot.findUnique({
          where: { supportRequestId: row.supportRequestId },
          select: { version: true },
        }),
      row.supportRequestId,
      previousVersion,
    );
    if (previousVersion === 0) {
      await tx.supportRequestSnapshot.create({ data: row });
    } else {
      const updated = await tx.supportRequestSnapshot.updateMany({
        where: { supportRequestId: row.supportRequestId, version: previousVersion },
        data: { ...row },
      });
      if (updated.count === 0) {
        throw new AccountVersionConflictError(row.supportRequestId, previousVersion);
      }
    }
  }
}
