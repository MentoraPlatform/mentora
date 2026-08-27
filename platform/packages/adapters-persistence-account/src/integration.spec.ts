import type {
  ChoreographyCommand,
  ChoreographyPosition,
} from '@mentora/application-account';
import type { ReactionResult } from '@mentora/application-kernel';
import { personIdOf, subscriptionIdOf } from '@mentora/domain-account';
import { accountRepositoryContractSuite, bornAccount } from '@mentora/domain-account/account-contract-suite';
import {
  availabilityFrameRepositoryContractSuite,
  bornFrame,
} from '@mentora/domain-account/availability-frame-contract-suite';
import {
  startedSubscription,
  subscriptionRepositoryContractSuite,
} from '@mentora/domain-account/subscription-contract-suite';
import { supportRequestRepositoryContractSuite } from '@mentora/domain-account/support-request-contract-suite';
import { RuntimeBuilder } from '@mentora/runtime-bootstrap';
import { environmentSource } from '@mentora/runtime-config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaChoreographyStore } from './choreography/prisma-choreography-store.js';
import { AccountPersistenceModule } from './module/account-persistence-module.js';
import { PrismaAccountStateReadAdapter } from './read-model/prisma-account-state-read-adapter.js';
import { AccountPersistenceFixture } from './testing/account-persistence-fixture.js';

/**
 * INTEGRATION against the real PostgreSQL engine (Story #16 — THE
 * acceptance criterion of the lot): the FOUR contract suites replayed on
 * the real registries, the atomic act proven whole-or-nothing, the R-A
 * partial index applied AND released, corruption surfaced, the read
 * adapters' grids, the choreography store, the I-11 lifecycle. Gated on
 * the DECLARED test URL — absent → skip; the official gate runs it.
 */

const url = environmentSource().read('MENTORA_ACCOUNT_DATABASE_URL');

describe.skipIf(url === undefined)('PostgreSQL integration — the Account registries (real engine)', () => {
  const fixture = new AccountPersistenceFixture(url ?? '');

  beforeEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  // ---- THE FOUR PROMISES, replayed on the real engine (I-10).
  accountRepositoryContractSuite('PrismaAccountRepositoryAdapter', {
    make: async () => {
      await fixture.truncate();
      return { repository: fixture.accounts };
    },
  });
  availabilityFrameRepositoryContractSuite('PrismaAvailabilityFrameRepositoryAdapter', {
    make: async () => {
      await fixture.truncate();
      return { repository: fixture.frames };
    },
  });
  subscriptionRepositoryContractSuite('PrismaSubscriptionRepositoryAdapter', {
    make: async () => {
      await fixture.truncate();
      return { repository: fixture.subscriptions };
    },
  });
  supportRequestRepositoryContractSuite('PrismaSupportRequestRepositoryAdapter', {
    make: async () => {
      await fixture.truncate();
      return { repository: fixture.supportRequests };
    },
  });

  it('retention writes fact-stream AND Outbox de faits in the SAME atomic act, keyed by unit subject (A-3)', async () => {
    await fixture.accounts.retain(bornAccount('person-1'), {
      correlationId: 'corr-a04',
      causationId: 'cmd-a04',
    });
    await fixture.subscriptions.retain(startedSubscription('sub-1', 'person-1'));
    const facts = await fixture.prisma.accountFact.findMany({ orderBy: [{ subjectKey: 'asc' }] });
    expect(facts.map((fact) => `${fact.subjectKey}|${fact.type}`)).toEqual([
      'account:person-1|PersonRegistered',
      'subscription:sub-1|SubscriptionStarted',
    ]);
    const outbox = await fixture.prisma.accountOutbox.findMany({ orderBy: { id: 'asc' } });
    expect(outbox).toHaveLength(2);
    expect(outbox[0]?.correlationId).toBe('corr-a04');
    expect(outbox[0]?.causationId).toBe('cmd-a04');
    expect(outbox[1]?.correlationId).toBeNull();
    expect(outbox.every((row) => row.status === 'pending')).toBe(true);
  });

  it('a STATE-ONLY act (device) advances the photograph version and writes NO fact, NO outbox row', async () => {
    await fixture.accounts.retain(bornAccount('person-1'));
    const loaded = await fixture.accounts.byId(personIdOf('person-1'));
    if (!loaded.some) throw new Error('unreachable');
    const withDevice = loaded.value.registerDevice({
      commandId: 'cmd-dev' as never,
      personId: personIdOf('person-1'),
      deviceId: 'dev-1' as never,
      registeredAt: { epochMillis: 2_000 } as never,
    });
    if (!withDevice.ok) throw new Error('unreachable');
    expect((await fixture.accounts.retain(withDevice.value)).ok).toBe(true);
    const photo = await fixture.prisma.accountSnapshot.findUnique({ where: { personId: 'person-1' } });
    expect(photo?.version).toBe(2);
    expect(await fixture.prisma.accountFact.count()).toBe(1); // PersonRegistered only
    expect(await fixture.prisma.accountOutbox.count()).toBe(1);
  });

  it('the R-A partial index refuses the second ACTIVE subscription and RELEASES the key when the first ends', async () => {
    await fixture.subscriptions.retain(startedSubscription('sub-1', 'person-1'));
    const second = await fixture.subscriptions.retain(startedSubscription('sub-2', 'person-1'));
    expect(!second.ok && second.error.reason).toBe('SubscriptionAlreadyExists');
    // Nothing partial: the refused retention left no fact and no outbox row.
    expect(await fixture.prisma.accountFact.count({ where: { subjectKey: 'subscription:sub-2' } })).toBe(0);
    const loaded = await fixture.subscriptions.byId(subscriptionIdOf('sub-1'));
    if (!loaded.some) throw new Error('unreachable');
    const ended = loaded.value.end({
      commandId: 'cmd-end' as never,
      subscriptionId: subscriptionIdOf('sub-1'),
      motive: 'done',
      endedAt: { epochMillis: 3_000 } as never,
    });
    if (!ended.ok) throw new Error('unreachable');
    expect((await fixture.subscriptions.retain(ended.value)).ok).toBe(true);
    const third = await fixture.subscriptions.retain(startedSubscription('sub-3', 'person-1'));
    expect(third.ok).toBe(true); // the key RELEASED
    const probe = await fixture.subscriptions.activeByHolder(personIdOf('person-1'));
    expect(probe.some && probe.value.id).toBe('sub-3');
  });

  it('a corrupted row surfaces as PERSIST.CORRUPTION — never a lying unit', async () => {
    await fixture.accounts.retain(bornAccount('person-1'));
    await fixture.prisma.accountSnapshot.update({
      where: { personId: 'person-1' },
      data: { checksum: 'deadbeef' },
    });
    await expect(fixture.accounts.byId(personIdOf('person-1'))).rejects.toThrow(/corrupted/);
  });

  it('the read adapters serve the two ratified lectures from the VERIFIED photographs; the grid holds', async () => {
    const reads = new PrismaAccountStateReadAdapter(fixture.prisma, 'notification-sanctioned' as never);
    await fixture.accounts.retain(bornAccount('person-1'));
    await fixture.frames.retain(bornFrame('person-1'));
    const frame = await reads.frameOf(personIdOf('person-1'));
    expect(frame.some && frame.value.windows).toHaveLength(1);
    const reachability = await reads.reachabilityOf(personIdOf('person-1'));
    expect(reachability.some && reachability.value.accountState).toBe('Active');
    expect(reachability.some && 'channel' in reachability.value).toBe(false);
    expect(await reads.holdsReachabilityRight('person-1' as never, personIdOf('person-1'))).toBe(true);
    expect(await reads.holdsReachabilityRight('notification-sanctioned' as never, personIdOf('person-1'))).toBe(true);
    expect(await reads.holdsReachabilityRight('person-2' as never, personIdOf('person-1'))).toBe(false);
    expect((await reads.frameOf(personIdOf('person-ghost'))).some).toBe(false);
  });

  it('the choreography store: atomic retain (Inbox + position + Outbox de commandes), dedup, drain, corruption', async () => {
    const store = new PrismaChoreographyStore(fixture.prisma, () => 5_000);
    const result: ReactionResult<ChoreographyPosition, ChoreographyCommand> = {
      position: { activeSubscriptionId: 'sub-1' },
      commands: [
        {
          contractVersion: 1,
          type: 'EndSubscription',
          commandId: 'choreography:sub-1:account-closed:5000' as never,
          personId: 'person-1' as never,
          subscriptionId: 'sub-1' as never,
          motive: 'account-closed',
        },
      ],
    };
    expect(await store.seen('fact-1')).toBe(false);
    await store.retain('fact-1', 'person-1', result);
    expect(await store.seen('fact-1')).toBe(true);
    const position = await store.positionOf('person-1');
    expect(position.some && position.value.activeSubscriptionId).toBe('sub-1');
    const pending = await store.pendingCommands();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.command.type).toBe('EndSubscription');
    await store.markCarried([pending[0]?.key ?? '']);
    expect(await store.pendingCommands()).toHaveLength(0);
    await fixture.prisma.choreographyPosition.update({
      where: { journeyKey: 'person-1' },
      data: { checksum: 'deadbeef' },
    });
    await expect(store.positionOf('person-1')).rejects.toThrow(/corrupted/);
  });

  it('the persistence module lives and dies with the runtime lifecycle (I-11)', async () => {
    const container = new RuntimeBuilder()
      .withModule(new AccountPersistenceModule(fixture.prisma))
      .build();
    await container.boot();
    expect(container.state).toBe('Active');
    await container.shutdown();
    expect(container.state).toBe('Destroyed');
  });
});
