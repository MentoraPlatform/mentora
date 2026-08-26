import { registerPerson, personIdOf, commandIdOf, verificationStateOf } from '@mentora/domain-account';
import { instantOf } from '@mentora/kernel';
import { environmentSource } from '@mentora/runtime-config';
import type { RelayEnvelope } from '@mentora/runtime-relay';
import { relayContractSuite } from '@mentora/runtime-relay/contract-suite';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaAccountRelaySource } from './relay/prisma-account-relay-source.js';
import { AccountPersistenceFixture } from './testing/account-persistence-fixture.js';

/**
 * The SQL binding of the Account Outbox de faits to the relay's source port
 * (reference: identity relay-source.spec) — the relay contract suite
 * REPLAYED against the real engine.
 */

const url = environmentSource().read('MENTORA_ACCOUNT_DATABASE_URL');

describe.skipIf(url === undefined)('PrismaAccountRelaySource (real engine)', () => {
  const fixture = new AccountPersistenceFixture(url ?? '');

  afterAll(async () => {
    await fixture.dispose();
  });

  const seed = async (envelope: RelayEnvelope): Promise<void> => {
    await fixture.prisma.accountOutbox.create({
      data: {
        messageId: envelope.messageId,
        subjectKey: envelope.subjectKey,
        sequence: envelope.sequence,
        payload: envelope.payload,
        occurredAtMs: BigInt(envelope.occurredAtMs),
        deliveryAttempts: envelope.deliveryAttempts,
        ...(envelope.correlationId !== undefined ? { correlationId: envelope.correlationId } : {}),
        ...(envelope.causationId !== undefined ? { causationId: envelope.causationId } : {}),
      },
    });
  };

  relayContractSuite('PrismaAccountRelaySource', {
    make: async () => {
      await fixture.truncate();
      return { source: new PrismaAccountRelaySource(fixture.prisma), seed };
    },
  });

  it('the RETAINED outbox rows are claimable by the relay — the loop closes (A-3 → A-4)', async () => {
    await fixture.truncate();
    const born = registerPerson({
      commandId: commandIdOf('cmd-relay'),
      personId: personIdOf('person-relay'),
      verificationState: verificationStateOf('unverified'),
      registeredAt: instantOf(1_000),
    });
    if (!born.ok) throw new Error('unreachable');
    await fixture.accounts.retain(born.value, { correlationId: 'corr-a04-relay' });
    const source = new PrismaAccountRelaySource(fixture.prisma);
    const claimed = await source.claimBatch({ limit: 10, nowMs: 1, claimedUntilMs: 10_000 });
    expect(claimed.map((envelope) => `${envelope.subjectKey}:${String(envelope.sequence)}`)).toEqual([
      'account:person-relay:1',
    ]);
    // RFC-001 end to end: the envelope carries what the retention received.
    expect(claimed[0]?.correlationId).toBe('corr-a04-relay');
  });
});
