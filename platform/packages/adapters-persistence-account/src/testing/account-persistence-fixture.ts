import { AccountFactStreamStore } from '../fact-stream/account-fact-stream-store.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { AccountOutboxStore } from '../outbox/account-outbox-store.js';
import {
  PrismaAccountRepositoryAdapter,
  PrismaAvailabilityFrameRepositoryAdapter,
  PrismaSubscriptionRepositoryAdapter,
  PrismaSupportRequestRepositoryAdapter,
} from '../repository/prisma-account-repository-adapters.js';
import {
  AccountRetentionEngine,
  AvailabilityFrameRetentionEngine,
  SubscriptionRetentionEngine,
  SupportRequestRetentionEngine,
} from '../retention/account-retention-engines.js';

import { UuidFactory } from './uuid-source.js';

/**
 * AccountPersistenceFixture — the integration harness (reference:
 * IdentityPersistenceFixture): one PrismaClient on the DECLARED test URL,
 * truncation between tests (the schema is applied once by `prisma migrate
 * deploy`). Spec data only (S-9).
 */
export class AccountPersistenceFixture {
  readonly prisma: PrismaClient;
  readonly accounts: PrismaAccountRepositoryAdapter;
  readonly frames: PrismaAvailabilityFrameRepositoryAdapter;
  readonly subscriptions: PrismaSubscriptionRepositoryAdapter;
  readonly supportRequests: PrismaSupportRequestRepositoryAdapter;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const factStream = new AccountFactStreamStore();
    const outbox = new AccountOutboxStore(new UuidFactory());
    this.accounts = new PrismaAccountRepositoryAdapter(
      this.prisma,
      new AccountRetentionEngine(factStream, outbox),
    );
    this.frames = new PrismaAvailabilityFrameRepositoryAdapter(
      this.prisma,
      new AvailabilityFrameRetentionEngine(factStream, outbox),
    );
    this.subscriptions = new PrismaSubscriptionRepositoryAdapter(
      this.prisma,
      new SubscriptionRetentionEngine(factStream, outbox),
    );
    this.supportRequests = new PrismaSupportRequestRepositoryAdapter(
      this.prisma,
      new SupportRequestRetentionEngine(),
    );
  }

  async truncate(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'TRUNCATE "AccountSnapshot", "AvailabilityFrameSnapshot", "SubscriptionSnapshot", "SupportRequestSnapshot", "AccountFact", "AccountOutbox", "AccountInbox", "ChoreographyInbox", "ChoreographyPosition", "ChoreographyCommand"',
    );
  }

  async dispose(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
