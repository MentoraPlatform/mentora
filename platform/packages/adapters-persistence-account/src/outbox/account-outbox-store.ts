import { serializeAccountEvent } from '@mentora/contracts-account';
import type { IdGenerator, RetentionContext } from '@mentora/kernel';

import type { AccountContextDomainEvent } from '../fact-stream/account-fact-mapper.js';
import { subjectKeyOf, toWireFact } from '../fact-stream/account-fact-mapper.js';
import type { Prisma } from '../generated/prisma/client.js';


/**
 * AccountOutboxStore — WRITE ONLY (reference: credential-outbox-store): the
 * relay reads pending and carries at-least-once. One row per fact, born in
 * the SAME atomic retention (A-3/M-4); fresh MessageId per write;
 * correlation/causation from the OPTIONAL RetentionContext (RFC-001) —
 * absent context writes NULL. deliveryAttempts live HERE, never in a
 * position (P-4).
 */
export class AccountOutboxStore {
  constructor(private readonly messageIds: IdGenerator) {}

  async write(
    tx: Prisma.TransactionClient,
    facts: readonly AccountContextDomainEvent[],
    context?: RetentionContext,
  ): Promise<void> {
    if (facts.length === 0) {
      return;
    }
    await tx.accountOutbox.createMany({
      data: facts.map((fact) => {
        const wire = toWireFact(fact);
        return {
          messageId: this.messageIds.generate(),
          subjectKey: subjectKeyOf(wire),
          sequence: wire.sequence,
          payload: serializeAccountEvent(wire),
          occurredAtMs: BigInt(wire.occurredAtMs),
          ...(context?.correlationId !== undefined ? { correlationId: context.correlationId } : {}),
          ...(context?.causationId !== undefined ? { causationId: context.causationId } : {}),
        };
      }),
    });
  }
}
