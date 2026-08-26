import {
  Account,
  AvailabilityFrame,
  Subscription,
  SupportRequest,
} from '@mentora/domain-account';

import { AccountPersistenceCorruptionException } from '../errors/account-persistence-errors.js';
import {
  accountSnapshotChecksum,
  deserializeAccountSnapshot,
  deserializeAvailabilityFrameSnapshot,
  deserializeSubscriptionSnapshot,
  deserializeSupportRequestSnapshot,
  serializeAccountSnapshot,
  serializeAvailabilityFrameSnapshot,
  serializeSubscriptionSnapshot,
  serializeSupportRequestSnapshot,
} from '../serialization/account-snapshot-serializer.js';

/**
 * The four mappers — unit ⇄ registry row through the domain's OWN doors
 * (snapshot()/fromSnapshot — I-3; reference: identity snapshot mappers).
 * The extra columns (stateKind, personId, verificationState, reachability)
 * are MATERIALIZED INDEXES of the declared walks (R-A probe, read
 * adapters) — derived from the photograph, never a second truth.
 */

interface StoredRow {
  readonly payload: string;
  readonly checksum: string;
}

const verified = <T>(
  row: StoredRow,
  subject: string,
  deserialize: (payload: string) => { ok: true; value: T } | { ok: false; error: string },
): T => {
  if (accountSnapshotChecksum(row.payload) !== row.checksum) {
    throw new AccountPersistenceCorruptionException(subject, 'checksum mismatch');
  }
  const snapshot = deserialize(row.payload);
  if (!snapshot.ok) {
    throw new AccountPersistenceCorruptionException(subject, snapshot.error);
  }
  return snapshot.value;
};

// ---------------------------------------------------------------- Account

export interface AccountRow {
  readonly personId: string;
  readonly version: number;
  readonly payload: string;
  readonly checksum: string;
  readonly stateKind: string;
  readonly verificationState: string;
  readonly reachability: string | null;
}

export const toAccountRow = (unit: Account): AccountRow => {
  const snapshot = unit.snapshot();
  const serialized = serializeAccountSnapshot(snapshot);
  return {
    personId: snapshot.personId,
    version: snapshot.version,
    payload: serialized.payload,
    checksum: serialized.checksum,
    stateKind: snapshot.state.kind,
    verificationState: snapshot.verificationState,
    reachability: snapshot.reachability ?? null,
  };
};

export const toAccountUnit = (row: StoredRow & { readonly personId: string }): Account =>
  Account.fromSnapshot(verified(row, row.personId, deserializeAccountSnapshot));

// ------------------------------------------------------- AvailabilityFrame

export interface AvailabilityFrameRow {
  readonly personId: string;
  readonly version: number;
  readonly payload: string;
  readonly checksum: string;
}

export const toAvailabilityFrameRow = (unit: AvailabilityFrame): AvailabilityFrameRow => {
  const snapshot = unit.snapshot();
  const serialized = serializeAvailabilityFrameSnapshot(snapshot);
  return {
    personId: snapshot.personId,
    version: snapshot.version,
    payload: serialized.payload,
    checksum: serialized.checksum,
  };
};

export const toAvailabilityFrameUnit = (
  row: StoredRow & { readonly personId: string },
): AvailabilityFrame =>
  AvailabilityFrame.fromSnapshot(verified(row, row.personId, deserializeAvailabilityFrameSnapshot));

// ------------------------------------------------------------ Subscription

export interface SubscriptionRow {
  readonly subscriptionId: string;
  readonly version: number;
  readonly payload: string;
  readonly checksum: string;
  readonly personId: string;
  readonly stateKind: string;
}

export const toSubscriptionRow = (unit: Subscription): SubscriptionRow => {
  const snapshot = unit.snapshot();
  const serialized = serializeSubscriptionSnapshot(snapshot);
  return {
    subscriptionId: snapshot.subscriptionId,
    version: snapshot.version,
    payload: serialized.payload,
    checksum: serialized.checksum,
    personId: snapshot.personId,
    stateKind: snapshot.state.kind,
  };
};

export const toSubscriptionUnit = (
  row: StoredRow & { readonly subscriptionId: string },
): Subscription =>
  Subscription.fromSnapshot(verified(row, row.subscriptionId, deserializeSubscriptionSnapshot));

// ---------------------------------------------------------- SupportRequest

export interface SupportRequestRow {
  readonly supportRequestId: string;
  readonly version: number;
  readonly payload: string;
  readonly checksum: string;
  readonly stateKind: string;
}

export const toSupportRequestRow = (unit: SupportRequest): SupportRequestRow => {
  const snapshot = unit.snapshot();
  const serialized = serializeSupportRequestSnapshot(snapshot);
  return {
    supportRequestId: snapshot.supportRequestId,
    version: snapshot.version,
    payload: serialized.payload,
    checksum: serialized.checksum,
    stateKind: snapshot.state.kind,
  };
};

export const toSupportRequestUnit = (
  row: StoredRow & { readonly supportRequestId: string },
): SupportRequest =>
  SupportRequest.fromSnapshot(verified(row, row.supportRequestId, deserializeSupportRequestSnapshot));
