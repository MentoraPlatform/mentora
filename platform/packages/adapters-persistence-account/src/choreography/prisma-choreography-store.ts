import type {
  ChoreographyCommand,
  ChoreographyPosition,
  ChoreographyStorePort,
} from '@mentora/application-account';
import type { ReactionResult } from '@mentora/application-kernel';
import { validateAccountCommand } from '@mentora/contracts-account';
import type { Option } from '@mentora/kernel';
import { none, some } from '@mentora/kernel';
import { canonicalJson, fnv1aChecksum } from '@mentora/runtime-serialization';

import { AccountPersistenceCorruptionException } from '../errors/account-persistence-errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * PrismaChoreographyStore — the real journey store of the DECLARED Account
 * choreography (RFC-003 P3/P4; reference behavior: InMemoryChoreographyStore,
 * proven by the application specs). Pas 4 of the Réaction is ONE atomic
 * write: Inbox mark + position + emitted commands (the Outbox de
 * commandes) in a single transaction — talks to no one (A-3's reaction
 * twin). The position is a VersionedPayload-free canonical JSON with a
 * checksum (corruption throws, never a lying position). Commands are
 * validated against the PUBLISHED language when read back — a stored
 * command that no longer validates is corruption, not a dispatchable act.
 */
export class PrismaChoreographyStore implements ChoreographyStorePort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clockNowMs: () => number,
  ) {}

  async seen(factIdentity: string): Promise<boolean> {
    const row = await this.prisma.choreographyInbox.findUnique({ where: { factIdentity } });
    return row !== null;
  }

  async positionOf(journeyKey: string): Promise<Option<ChoreographyPosition>> {
    const row = await this.prisma.choreographyPosition.findUnique({ where: { journeyKey } });
    if (row === null) {
      return none;
    }
    if (fnv1aChecksum.checksum(row.payload) !== row.checksum) {
      throw new AccountPersistenceCorruptionException(journeyKey, 'position checksum mismatch');
    }
    return some(JSON.parse(row.payload) as ChoreographyPosition);
  }

  async retain(
    factIdentity: string,
    journeyKey: string,
    result: ReactionResult<ChoreographyPosition, ChoreographyCommand>,
  ): Promise<void> {
    const serialized = canonicalJson(result.position);
    if (!serialized.ok) {
      throw new AccountPersistenceCorruptionException(journeyKey, 'position refused to canonicalize');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.choreographyInbox.create({
        data: { factIdentity, retainedAtMs: BigInt(this.clockNowMs()) },
      });
      await tx.choreographyPosition.upsert({
        where: { journeyKey },
        create: {
          journeyKey,
          payload: serialized.value,
          checksum: fnv1aChecksum.checksum(serialized.value),
        },
        update: {
          payload: serialized.value,
          checksum: fnv1aChecksum.checksum(serialized.value),
        },
      });
      for (const command of result.commands) {
        await tx.choreographyCommand.create({
          data: { commandId: command.commandId, payload: JSON.stringify(command) },
        });
      }
    });
  }

  async pendingCommands(): Promise<
    readonly { readonly key: string; readonly command: ChoreographyCommand }[]
  > {
    const rows = await this.prisma.choreographyCommand.findMany({ orderBy: { id: 'asc' } });
    return rows.map((row) => {
      const validated = validateAccountCommand(JSON.parse(row.payload));
      if (!validated.ok || validated.value.type !== 'EndSubscription') {
        throw new AccountPersistenceCorruptionException(row.commandId, 'stored command no longer validates');
      }
      return { key: String(row.id), command: validated.value };
    });
  }

  async markCarried(keys: readonly string[]): Promise<void> {
    await this.prisma.choreographyCommand.deleteMany({
      where: { id: { in: keys.map((key) => BigInt(key)) } },
    });
  }
}
