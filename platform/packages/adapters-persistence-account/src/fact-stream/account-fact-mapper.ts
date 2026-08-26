import type { AccountEventContract } from '@mentora/contracts-account';
import { serializeAccountEvent } from '@mentora/contracts-account';
import type {
  AccountDomainEvent,
  AvailabilityFrameDomainEvent,
  SubscriptionDomainEvent,
} from '@mentora/domain-account';
import { fnv1aChecksum } from '@mentora/runtime-serialization';

/**
 * The fact-mapper — domain fact → PUBLISHED wire fact (reference:
 * credential-fact-mapper). The wire serialization belongs to the OWNER's
 * deterministic serializers (V-1) — called, never redefined. Facts carry
 * identities, natures, instants — never a matter. The SUBJECT KEY of each
 * fact (the unit's identity: the person for Account/frame facts, the
 * subscription for its own) keys the context-wide stream and outbox.
 */

export type AccountContextDomainEvent =
  | AccountDomainEvent
  | AvailabilityFrameDomainEvent
  | SubscriptionDomainEvent;

export const toWireFact = (fact: AccountContextDomainEvent): AccountEventContract => {
  switch (fact.type) {
    case 'PersonRegistered':
      return {
        contractVersion: 1,
        type: 'PersonRegistered',
        personId: fact.personId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        verificationState: fact.verificationState,
      };
    case 'PreferenceChanged':
      return {
        contractVersion: 1,
        type: 'PreferenceChanged',
        personId: fact.personId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        preferenceKind: fact.preferenceKind,
        preferenceValue: fact.preferenceValue,
      };
    case 'ReachabilityChanged':
      return {
        contractVersion: 1,
        type: 'ReachabilityChanged',
        personId: fact.personId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        channel: fact.channel,
      };
    case 'AccountClosed':
      return {
        contractVersion: 1,
        type: 'AccountClosed',
        personId: fact.personId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        motive: fact.motive,
      };
    case 'AvailabilityFrameChanged':
      return {
        contractVersion: 1,
        type: 'AvailabilityFrameChanged',
        personId: fact.personId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        windows: fact.windows.map((window) => ({
          startMs: window.start.epochMillis,
          endMs: window.end.epochMillis,
        })),
      };
    case 'SubscriptionStarted':
      return {
        contractVersion: 1,
        type: 'SubscriptionStarted',
        subscriptionId: fact.subscriptionId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        personId: fact.personId,
        offerReference: fact.offerReference,
      };
    case 'SubscriptionEnded':
      return {
        contractVersion: 1,
        type: 'SubscriptionEnded',
        subscriptionId: fact.subscriptionId,
        sequence: fact.sequence,
        occurredAtMs: fact.instant.epochMillis,
        motive: fact.motive,
      };
  }
};

/** The subject key of a wire fact — the unit identity the stream orders by (F4.3 §4). */
export const subjectKeyOf = (wire: AccountEventContract): string =>
  wire.type === 'SubscriptionStarted' || wire.type === 'SubscriptionEnded'
    ? wire.subscriptionId
    : wire.personId;

export interface AccountFactRow {
  readonly subjectKey: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: string;
  readonly contractVersion: number;
  readonly occurredAtMs: bigint;
  readonly checksum: string;
}

export const toFactRow = (fact: AccountContextDomainEvent): AccountFactRow => {
  const wire = toWireFact(fact);
  const payload = serializeAccountEvent(wire);
  return {
    subjectKey: subjectKeyOf(wire),
    sequence: wire.sequence,
    type: wire.type,
    payload,
    contractVersion: wire.contractVersion,
    occurredAtMs: BigInt(wire.occurredAtMs),
    checksum: fnv1aChecksum.checksum(payload),
  };
};
