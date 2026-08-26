import type { Prisma } from '../generated/prisma/client.js';

import type { AccountContextDomainEvent } from './account-fact-mapper.js';
import { toFactRow } from './account-fact-mapper.js';

/**
 * AccountFactStreamStore — the append-only fact stream of the CONTEXT
 * (RC-1 §3; reference: credential-fact-stream-store): the eternal
 * provenance (O-4), keyed by unit subject. Append happens INSIDE the
 * retention transaction; unique(subjectKey, sequence) is the structural
 * idempotence. No UPDATE, no DELETE, ever (S-9).
 */
export class AccountFactStreamStore {
  async append(
    tx: Prisma.TransactionClient,
    facts: readonly AccountContextDomainEvent[],
  ): Promise<void> {
    if (facts.length === 0) {
      return;
    }
    await tx.accountFact.createMany({ data: facts.map(toFactRow) });
  }

  async readStream(
    tx: Prisma.TransactionClient,
    subjectKey: string,
  ): Promise<readonly { sequence: number; type: string; payload: string; checksum: string }[]> {
    return tx.accountFact.findMany({
      where: { subjectKey },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, type: true, payload: true, checksum: true },
    });
  }
}
