import type {
  Account,
  AccountRefusal,
  AccountRepository,
  AvailabilityFrame,
  AvailabilityFrameRefusal,
  AvailabilityFrameRepository,
  PersonId,
  Subscription,
  SubscriptionId,
  SubscriptionRefusal,
  SubscriptionRepository,
  SupportRequest,
  SupportRequestId,
  SupportRequestRefusal,
  SupportRequestRepository,
} from '@mentora/domain-account';
import {
  accountRefusal,
  availabilityFrameRefusal,
  subscriptionRefusal,
  supportRequestRefusal,
} from '@mentora/domain-account';
import type { Option, Result, RetentionContext } from '@mentora/kernel';
import { err, none, ok, some } from '@mentora/kernel';

import { classifyEngineError } from '../concurrency/account-optimistic-concurrency-guard.js';
import { AccountVersionConflictError } from '../errors/account-persistence-errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  AccountRetentionEngine,
  AvailabilityFrameRetentionEngine,
  SubscriptionRetentionEngine,
  SupportRequestRetentionEngine,
} from '../retention/account-retention-engines.js';
import {
  toAccountUnit,
  toAvailabilityFrameUnit,
  toSubscriptionUnit,
  toSupportRequestUnit,
} from '../snapshot/account-snapshot-mappers.js';

/**
 * The four registry facades — the real implementations of the domain's
 * frozen ports (reference: PrismaCredentialRepositoryAdapter). The port is
 * the law; the facades delegate to the engines and CLASSIFY collisions
 * OUTSIDE the aborted transaction, post-rollback:
 * - the R-A partial index → `SubscriptionAlreadyExists` (a VALUE);
 * - a photograph pkey collision → R-B refusal (`TransitionUnavailable`);
 * - a version conflict → rethrown (transient Failure, S-3);
 * - anything else → rethrown (engine Failure, R-10);
 * - corruption on load → AccountPersistenceCorruptionException, raw (A-7).
 */

const rbMessage = (truth: string): string =>
  `A ${truth} already lives under this Identifier — a new unit requires a new identity (R-B)`;

const retainThrough = async <TRefusal>(
  prisma: PrismaClient,
  act: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<void>,
  onCollision: (collision: 'ra-key' | 'duplicate-identity') => TRefusal,
): Promise<Result<void, TRefusal>> => {
  try {
    await prisma.$transaction(async (tx) => act(tx), { isolationLevel: 'Serializable' });
    return ok(undefined);
  } catch (error) {
    if (error instanceof AccountVersionConflictError) {
      throw error;
    }
    const collision = classifyEngineError(error);
    if (collision === 'engine') {
      throw error;
    }
    return err(onCollision(collision));
  }
};

export class PrismaAccountRepositoryAdapter implements AccountRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: AccountRetentionEngine,
  ) {}

  async byId(id: PersonId): Promise<Option<Account>> {
    const row = await this.prisma.accountSnapshot.findUnique({ where: { personId: id } });
    return row === null ? none : some(toAccountUnit(row));
  }

  retain(account: Account, context?: RetentionContext): Promise<Result<void, AccountRefusal>> {
    return retainThrough(
      this.prisma,
      (tx) => this.engine.retainWithin(tx, account, context),
      () => accountRefusal('TransitionUnavailable', rbMessage('Account')),
    );
  }
}

export class PrismaAvailabilityFrameRepositoryAdapter implements AvailabilityFrameRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: AvailabilityFrameRetentionEngine,
  ) {}

  async byId(id: PersonId): Promise<Option<AvailabilityFrame>> {
    const row = await this.prisma.availabilityFrameSnapshot.findUnique({ where: { personId: id } });
    return row === null ? none : some(toAvailabilityFrameUnit(row));
  }

  retain(
    frame: AvailabilityFrame,
    context?: RetentionContext,
  ): Promise<Result<void, AvailabilityFrameRefusal>> {
    return retainThrough(
      this.prisma,
      (tx) => this.engine.retainWithin(tx, frame, context),
      () => availabilityFrameRefusal('TransitionUnavailable', rbMessage('AvailabilityFrame')),
    );
  }
}

export class PrismaSubscriptionRepositoryAdapter implements SubscriptionRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: SubscriptionRetentionEngine,
  ) {}

  async byId(id: SubscriptionId): Promise<Option<Subscription>> {
    const row = await this.prisma.subscriptionSnapshot.findUnique({
      where: { subscriptionId: id },
    });
    return row === null ? none : some(toSubscriptionUnit(row));
  }

  /** The R-A probe surface: the ACTIVE subscription of a holder — the declared walk. */
  async activeByHolder(personId: PersonId): Promise<Option<Subscription>> {
    const row = await this.prisma.subscriptionSnapshot.findFirst({
      where: { personId, stateKind: 'Active' },
    });
    return row === null ? none : some(toSubscriptionUnit(row));
  }

  retain(
    subscription: Subscription,
    context?: RetentionContext,
  ): Promise<Result<void, SubscriptionRefusal>> {
    return retainThrough(
      this.prisma,
      (tx) => this.engine.retainWithin(tx, subscription, context),
      (collision) =>
        collision === 'ra-key'
          ? subscriptionRefusal(
              'SubscriptionAlreadyExists',
              'An ACTIVE Subscription already exists for this holder (R-A key)',
            )
          : subscriptionRefusal('TransitionUnavailable', rbMessage('Subscription')),
    );
  }
}

export class PrismaSupportRequestRepositoryAdapter implements SupportRequestRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: SupportRequestRetentionEngine,
  ) {}

  async byId(id: SupportRequestId): Promise<Option<SupportRequest>> {
    const row = await this.prisma.supportRequestSnapshot.findUnique({
      where: { supportRequestId: id },
    });
    return row === null ? none : some(toSupportRequestUnit(row));
  }

  retain(request: SupportRequest): Promise<Result<void, SupportRequestRefusal>> {
    return retainThrough(
      this.prisma,
      (tx) => this.engine.retainWithin(tx, request),
      () => supportRequestRefusal('TransitionUnavailable', rbMessage('SupportRequest')),
    );
  }
}
