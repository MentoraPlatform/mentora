import type {
  ReactionJournalPort,
  ReactionStepRecord,
  ReadJournalPort,
  ReadStepRecord,
  SequenceJournalPort,
  SequenceStepRecord,
} from '@mentora/application-kernel';
import type { Logger } from '@mentora/shared';

/**
 * The Journal ports served through the executable's structured Log WELL.
 * DISCIPLINE HELD: the records ARE the applicative Journal of the Sequences
 * (A-10 — probative content: correlation, step, type, outcome, attempt —
 * never a matter); only their STORAGE WELL is the structured log stream of
 * this deployment stage (wells are interchangeable mechanisms — O-10). A
 * durable journal store is a future adapter; the record shape will not
 * change (the ports are the law). SIGNALED.
 */
export class LoggingSequenceJournal implements SequenceJournalPort {
  constructor(private readonly logger: Logger) {}

  record(entry: SequenceStepRecord): void {
    this.logger.info('sequence step', { ...entry });
  }
}

export class LoggingReadJournal implements ReadJournalPort {
  constructor(private readonly logger: Logger) {}

  record(entry: ReadStepRecord): void {
    this.logger.info('read step', { ...entry });
  }
}

export class LoggingReactionJournal implements ReactionJournalPort {
  constructor(private readonly logger: Logger) {}

  record(entry: ReactionStepRecord): void {
    this.logger.info('reaction step', { ...entry });
  }
}
