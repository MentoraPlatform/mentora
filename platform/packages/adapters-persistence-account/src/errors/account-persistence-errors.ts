import { SequenceExecutionException } from '@mentora/application-kernel';

/**
 * PERSIST.CORRUPTION (RC-2 §8; reference: identity-persistence-errors) — a
 * stored row that lies: an EXCEPTION, never a lying `none`. Propagates RAW
 * through the LoadingStage (A-7).
 */
export class AccountPersistenceCorruptionException extends SequenceExecutionException {
  readonly code: string = 'PERSIST.CORRUPTION';

  constructor(
    readonly subject: string,
    detail: string,
  ) {
    super(`Account registry row corrupted for '${subject}': ${detail}`);
  }
}

/**
 * PERSIST.VERSION_CONFLICT (F5.2 §4: a transient Failure, never a Decision).
 * A plain Error ON PURPOSE: the AtomicRetentionStage catches the throw and
 * yields the retryable Failure channel (S-3).
 */
export class AccountVersionConflictError extends Error {
  readonly code = 'PERSIST.VERSION_CONFLICT';

  constructor(subject: string, expectedVersion: number) {
    super(
      `PERSIST.VERSION_CONFLICT: two Sequences, one version — '${subject}' expected v${String(expectedVersion)}`,
    );
  }
}
