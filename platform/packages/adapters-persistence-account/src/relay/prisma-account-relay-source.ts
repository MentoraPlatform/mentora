import type {
  RelayBacklog,
  RelayClaimRequest,
  RelayEnvelope,
  RelaySourcePort,
} from '@mentora/runtime-relay';

import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * PrismaAccountRelaySource — the SQL binding of the Account Outbox de faits
 * to the relay's source port (reference: PrismaIdentityRelaySource, copied
 * exactly; the subject column is `subjectKey` — the context-wide outbox of
 * this package's justified divergence). The eligibility contract in ONE
 * claim transaction: pending + due + unclaimed/expired + no earlier
 * unpublished row of the same subject; oldest first; FOR UPDATE SKIP LOCKED
 * (a lease-optimization, never a guardian — F5.1 §19). Proven by
 * relayContractSuite against the real engine.
 */
export class PrismaAccountRelaySource implements RelaySourcePort {
  constructor(private readonly prisma: PrismaClient) {}

  async claimBatch(request: RelayClaimRequest): Promise<readonly RelayEnvelope[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: bigint;
          messageId: string;
          subjectKey: string;
          sequence: number;
          correlationId: string | null;
          causationId: string | null;
          deliveryAttempts: number;
          payload: string;
          occurredAtMs: bigint;
        }>
      >`
          SELECT o."id", o."messageId", o."subjectKey", o."sequence",
                 o."correlationId", o."causationId", o."deliveryAttempts",
                 o."payload", o."occurredAtMs"
          FROM "AccountOutbox" o
          WHERE o."status" = 'pending'
            AND o."nextAttemptAtMs" <= ${BigInt(request.nowMs)}
            AND o."claimedUntilMs" <= ${BigInt(request.nowMs)}
            AND NOT EXISTS (
              -- ONE in-flight envelope per subject (F4.3 §4 / M-8).
              SELECT 1 FROM "AccountOutbox" earlier
              WHERE earlier."subjectKey" = o."subjectKey"
                AND earlier."sequence" < o."sequence"
                AND earlier."status" <> 'published'
            )
          ORDER BY o."id" ASC
          LIMIT ${request.limit}
          FOR UPDATE OF o SKIP LOCKED
        `;
      if (rows.length > 0) {
        await tx.accountOutbox.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { claimedUntilMs: BigInt(request.claimedUntilMs) },
        });
      }
      return rows.map((row) => ({
        messageId: row.messageId,
        subjectKey: row.subjectKey,
        sequence: row.sequence,
        payload: row.payload,
        occurredAtMs: Number(row.occurredAtMs),
        ...(row.correlationId !== null ? { correlationId: row.correlationId } : {}),
        ...(row.causationId !== null ? { causationId: row.causationId } : {}),
        deliveryAttempts: row.deliveryAttempts,
      }));
    });
  }

  async markPublished(messageId: string): Promise<void> {
    await this.prisma.accountOutbox.update({
      where: { messageId },
      data: { status: 'published', claimedUntilMs: BigInt(0) },
    });
  }

  async recordAttempt(messageId: string, nextAttemptAtMs: number): Promise<void> {
    await this.prisma.accountOutbox.update({
      where: { messageId },
      data: {
        deliveryAttempts: { increment: 1 },
        nextAttemptAtMs: BigInt(nextAttemptAtMs),
        claimedUntilMs: BigInt(0),
      },
    });
  }

  async quarantine(messageId: string, reason: string): Promise<void> {
    await this.prisma.accountOutbox.update({
      where: { messageId },
      data: { status: 'quarantined', quarantineReason: reason, claimedUntilMs: BigInt(0) },
    });
  }

  async backlog(nowMs: number): Promise<RelayBacklog> {
    const [pending, retrying, quarantined, oldest] = await Promise.all([
      this.prisma.accountOutbox.count({ where: { status: 'pending' } }),
      this.prisma.accountOutbox.count({
        where: { status: 'pending', deliveryAttempts: { gt: 0 } },
      }),
      this.prisma.accountOutbox.count({ where: { status: 'quarantined' } }),
      this.prisma.accountOutbox.findFirst({
        where: { status: 'pending' },
        orderBy: { occurredAtMs: 'asc' },
        select: { occurredAtMs: true },
      }),
    ]);
    return {
      pending,
      retrying,
      quarantined,
      oldestPendingAgeMs: oldest === null ? undefined : nowMs - Number(oldest.occurredAtMs),
    };
  }
}
