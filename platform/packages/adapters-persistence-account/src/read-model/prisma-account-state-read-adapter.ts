import type {
  AccountReadRightsPort,
  AvailabilityFrameReadPort,
  AvailabilityFrameView,
  ReachabilityReadPort,
  ReachabilityView,
} from '@mentora/application-account';
import type { ActorRef } from '@mentora/contracts';
import type { PersonId } from '@mentora/contracts-account';
import type { Option } from '@mentora/kernel';
import { none, some } from '@mentora/kernel';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  toAccountUnit,
  toAvailabilityFrameUnit,
} from '../snapshot/account-snapshot-mappers.js';

/**
 * The read adapters of the TWO ratified Account lectures (Story #16;
 * reference: PrismaAgreementStateReadAdapter / identity read adapters) —
 * strictly those, nothing more. Reads hit the PRIMARY (S-5). Views derive
 * from the VERIFIED photograph (checksum first — corruption throws, never
 * a lying view); the unit never exits.
 *
 * The R-C grid of ReachabilityQuery ("la Notification (sanctionnée) + le
 * Titulaire") is MECHANIZED here below its port (F4.1.99): the sanctioned
 * Notification is the DECLARED actor the Root injects; the holder is the
 * actor whose reference IS the account's identity (RFC-003 P1).
 * AvailabilityFrameQuery has no grid ("tous") — no rights surface exists
 * for it, by construction.
 */
export class PrismaAccountStateReadAdapter
  implements AvailabilityFrameReadPort, ReachabilityReadPort, AccountReadRightsPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notificationActor: ActorRef,
  ) {}

  async frameOf(personId: PersonId): Promise<Option<AvailabilityFrameView>> {
    const row = await this.prisma.availabilityFrameSnapshot.findUnique({ where: { personId } });
    if (row === null) {
      return none;
    }
    const snapshot = toAvailabilityFrameUnit(row).snapshot();
    return some({
      personId: snapshot.personId as PersonId,
      windows: snapshot.windows,
      version: snapshot.version,
    });
  }

  async reachabilityOf(personId: PersonId): Promise<Option<ReachabilityView>> {
    const row = await this.prisma.accountSnapshot.findUnique({ where: { personId } });
    if (row === null) {
      return none;
    }
    const snapshot = toAccountUnit(row).snapshot();
    return some({
      personId: snapshot.personId as PersonId,
      ...(snapshot.reachability === undefined ? {} : { channel: snapshot.reachability }),
      accountState: snapshot.state.kind,
    });
  }

  holdsReachabilityRight(actor: ActorRef, personId: PersonId): Promise<boolean> {
    return Promise.resolve(actor === this.notificationActor || (actor as string) === personId);
  }
}
