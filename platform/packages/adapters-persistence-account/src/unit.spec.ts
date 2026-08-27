import { validateAccountEvent } from '@mentora/contracts-account';
import {
  changeAvailabilityFrameBirth,
  registerPerson,
  startSubscription,
  openSupportRequest,
  SubscriptionPolicy,
  commandIdOf,
  personIdOf,
  subscriptionIdOf,
  supportRequestIdOf,
  verificationStateOf,
  reachabilityChannelOf,
} from '@mentora/domain-account';
import type { Account } from '@mentora/domain-account';
import { instantOf } from '@mentora/kernel';
import { describe, expect, it } from 'vitest';

import { previousVersionOf } from './concurrency/account-optimistic-concurrency-guard.js';
import { subjectKeyOf, toFactRow, toWireFact } from './fact-stream/account-fact-mapper.js';
import {
  toAccountRow,
  toAccountUnit,
  toAvailabilityFrameRow,
  toAvailabilityFrameUnit,
  toSubscriptionRow,
  toSubscriptionUnit,
  toSupportRequestRow,
  toSupportRequestUnit,
} from './snapshot/account-snapshot-mappers.js';

/**
 * The DB-less mechanics (reference: identity unit.spec): mappers round-trip
 * through the domain's own doors, wire facts validate against the published
 * language, the subject key follows the unit, the version law holds.
 */

const T0 = instantOf(1_000);

const unwrap = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

const bornAccount = (): Account =>
  unwrap(
    registerPerson({
      commandId: commandIdOf('cmd-1'),
      personId: personIdOf('person-1'),
      verificationState: verificationStateOf('unverified'),
      registeredAt: T0,
    }),
  );

describe('the four mappers — unit ⇄ row through the domain doors, checksum verified', () => {
  it('Account: row carries the materialized indexes; corruption throws; round-trip exact', () => {
    const rich = unwrap(
      bornAccount().changeReachability({
        commandId: commandIdOf('c'),
        personId: personIdOf('person-1'),
        channel: reachabilityChannelOf('email'),
        changedAt: T0,
      }),
    );
    const row = toAccountRow(rich);
    expect(row).toMatchObject({ personId: 'person-1', version: 2, stateKind: 'Active', reachability: 'email' });
    expect(toAccountUnit(row).snapshot()).toEqual(rich.snapshot());
    expect(() => toAccountUnit({ ...row, checksum: 'deadbeef' })).toThrow(/corrupted/);
    expect(() => toAccountUnit({ ...row, payload: '{not json' })).toThrow(/corrupted/);
  });

  it('AvailabilityFrame + Subscription + SupportRequest round-trip; the R-A columns are derived', () => {
    const frame = unwrap(
      changeAvailabilityFrameBirth({
        commandId: commandIdOf('c'),
        personId: personIdOf('person-1'),
        windows: [{ start: instantOf(1), end: instantOf(2) }],
        changedAt: T0,
      }),
    );
    expect(toAvailabilityFrameUnit(toAvailabilityFrameRow(frame)).snapshot()).toEqual(frame.snapshot());

    const subscription = unwrap(
      startSubscription(
        {
          commandId: commandIdOf('c'),
          subscriptionId: subscriptionIdOf('sub-1'),
          personId: personIdOf('person-1'),
          offerReference: 'offer-basic',
          startedAt: T0,
        },
        new SubscriptionPolicy({ admittedOffers: ['offer-basic'] }),
      ),
    );
    const subscriptionRow = toSubscriptionRow(subscription);
    expect(subscriptionRow).toMatchObject({ personId: 'person-1', stateKind: 'Active' });
    expect(toSubscriptionUnit(subscriptionRow).snapshot()).toEqual(subscription.snapshot());

    const support = unwrap(
      openSupportRequest({
        commandId: commandIdOf('c'),
        supportRequestId: supportRequestIdOf('sr-1'),
        requesterId: personIdOf('person-1'),
        motive: 'billing',
        openedAt: T0,
      }),
    );
    expect(toSupportRequestUnit(toSupportRequestRow(support)).snapshot()).toEqual(support.snapshot());
  });
});

describe('the fact mapper — wire facts of the published language, keyed by unit subject', () => {
  it('every domain fact maps to a VALID wire fact; the subject key follows the unit', () => {
    const account = unwrap(
      bornAccount().close({
        commandId: commandIdOf('c'),
        personId: personIdOf('person-1'),
        motive: 'leaving',
        closedAt: T0,
      }),
    );
    const subscription = unwrap(
      startSubscription(
        {
          commandId: commandIdOf('c'),
          subscriptionId: subscriptionIdOf('sub-1'),
          personId: personIdOf('person-1'),
          offerReference: 'offer-basic',
          startedAt: T0,
        },
        new SubscriptionPolicy({ admittedOffers: ['offer-basic'] }),
      ),
    );
    for (const fact of [...account.pendingFacts, ...subscription.pendingFacts]) {
      const wire = toWireFact(fact);
      expect(validateAccountEvent(wire).ok, wire.type).toBe(true);
      expect(subjectKeyOf(wire)).toBe(
        wire.type === 'SubscriptionStarted' ? 'subscription:sub-1' : 'account:person-1',
      );
      const row = toFactRow(fact);
      expect(row.subjectKey).toBe(subjectKeyOf(wire));
      expect(row.checksum.length).toBeGreaterThan(0);
    }
  });
});

describe('the version law of this context (justified divergence)', () => {
  it('expected previous = version − unretainedActs — device acts included, facts or not', () => {
    const account = bornAccount();
    expect(previousVersionOf(account)).toBe(0); // birth: version 1, one act
    const withDevice = unwrap(
      account.registerDevice({
        commandId: commandIdOf('c'),
        personId: personIdOf('person-1'),
        deviceId: 'dev-1' as never,
        registeredAt: T0,
      }),
    );
    // Two acts unretained (birth + device), version 2 → previous 0.
    expect(previousVersionOf(withDevice)).toBe(0);
    const retained = withDevice.retained();
    expect(previousVersionOf(retained)).toBe(2); // nothing unretained
  });
});
