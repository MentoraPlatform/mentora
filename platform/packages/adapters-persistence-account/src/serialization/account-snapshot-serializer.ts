import type {
  AccountSnapshot,
  AvailabilityFrameSnapshot,
  SubscriptionSnapshot,
  SupportRequestSnapshot,
} from '@mentora/domain-account';
import type { Result } from '@mentora/kernel';
import { err, ok } from '@mentora/kernel';
import {
  canonicalJson,
  fnv1aChecksum,
  readVersionedPayload,
  versionedPayload,
} from '@mentora/runtime-serialization';

/**
 * The PRIVATE photographs' bytes (RC-1 §1/§2; reference:
 * identity-snapshot-serializer): canonical JSON in a VersionedPayload
 * (formatVersion 1; evolution ADDITIVE ONLY — S-7). Never crosses a port.
 * Four pairs — one per Account registry.
 */

export const SNAPSHOT_FORMAT_VERSION = 1;

export interface SerializedSnapshot {
  readonly payload: string;
  readonly checksum: string;
}

/** FNV-1a — the fingerprint demonstrates, never decides. */
export const accountSnapshotChecksum = (payload: string): string =>
  fnv1aChecksum.checksum(payload);

const serialize = (snapshot: unknown, subject: string): SerializedSnapshot => {
  const text = canonicalJson(versionedPayload(SNAPSHOT_FORMAT_VERSION, snapshot));
  if (!text.ok) {
    throw new Error(`the ${subject} photograph refused to canonicalize: ${text.error.message}`);
  }
  return { payload: text.value, checksum: accountSnapshotChecksum(text.value) };
};

const deserialize = <T>(payload: string): Result<T, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return err('payload is not JSON');
  }
  const versioned = readVersionedPayload(parsed);
  if (!versioned.ok) {
    return err(versioned.error.message);
  }
  if (versioned.value.version !== SNAPSHOT_FORMAT_VERSION) {
    return err(`unknown photograph format v${String(versioned.value.version)}`);
  }
  return ok(versioned.value.payload as T);
};

export const serializeAccountSnapshot = (snapshot: AccountSnapshot): SerializedSnapshot =>
  serialize(snapshot, 'Account');
export const deserializeAccountSnapshot = (payload: string): Result<AccountSnapshot, string> =>
  deserialize<AccountSnapshot>(payload);

export const serializeAvailabilityFrameSnapshot = (
  snapshot: AvailabilityFrameSnapshot,
): SerializedSnapshot => serialize(snapshot, 'AvailabilityFrame');
export const deserializeAvailabilityFrameSnapshot = (
  payload: string,
): Result<AvailabilityFrameSnapshot, string> => deserialize<AvailabilityFrameSnapshot>(payload);

export const serializeSubscriptionSnapshot = (snapshot: SubscriptionSnapshot): SerializedSnapshot =>
  serialize(snapshot, 'Subscription');
export const deserializeSubscriptionSnapshot = (
  payload: string,
): Result<SubscriptionSnapshot, string> => deserialize<SubscriptionSnapshot>(payload);

export const serializeSupportRequestSnapshot = (
  snapshot: SupportRequestSnapshot,
): SerializedSnapshot => serialize(snapshot, 'SupportRequest');
export const deserializeSupportRequestSnapshot = (
  payload: string,
): Result<SupportRequestSnapshot, string> => deserialize<SupportRequestSnapshot>(payload);
