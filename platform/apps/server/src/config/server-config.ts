import { readFileSync } from 'node:fs';

import type { Result } from '@mentora/kernel';
import { environmentSource, inMemorySource, loadConfig } from '@mentora/runtime-config';
import type { ConfigSource, ConfigValues } from '@mentora/runtime-config';
import type { ConfigViolation } from '@mentora/runtime-config';

/**
 * The executable's DECLARED configuration (I-5): technical knobs + the
 * PRODUCT parameters riding as validated data toward the Root's Policy
 * construction (F4.1 §4). Loaded fail closed with the COMPLETE violation
 * list ("une seule erreur = pas de démarrage" — every error, then death,
 * once — F4.4 §7). Secrets never ride here — the database URL is dev
 * plumbing today; the vault reference discipline arrives with the vault
 * adapter (I-8, SIGNALED).
 */

export const SERVER_CONFIG_SCHEMA = {
  MENTORA_AGREEMENT_DATABASE_URL: { kind: 'string', nonBlank: true },
  MENTORA_IDENTITY_DATABASE_URL: { kind: 'string', nonBlank: true },
  MENTORA_ACCOUNT_DATABASE_URL: { kind: 'string', nonBlank: true },
  /** The executable's declared environment — gates the PROVISIONAL Settlement adapter (RFC-003 P4). */
  MENTORA_ENVIRONMENT: {
    kind: 'choice',
    values: ['development', 'staging', 'production'],
    default: 'development',
  },
  /** The sanctioned Notification actor of the ReachabilityQuery grid (declared, injected). */
  MENTORA_NOTIFICATION_ACTOR: { kind: 'string', nonBlank: true, default: 'notification-sanctioned' },
  /** The declared actor the Account choreography commands with (M-10 closed list). */
  MENTORA_CHOREOGRAPHY_ACTOR: { kind: 'string', nonBlank: true, default: 'account-choreography' },
  MENTORA_HTTP_PORT: { kind: 'number', min: 0, max: 65_535, default: 3001 },
  MENTORA_LOG_THRESHOLD: {
    kind: 'choice',
    values: ['debug', 'info', 'warn', 'error'],
    default: 'info',
  },
  MENTORA_TIME_TOOLING_ACTOR: { kind: 'string', nonBlank: true, default: 'time-tooling' },
  MENTORA_COMMAND_MAX_ATTEMPTS: { kind: 'number', min: 1, max: 10, default: 3 },
  MENTORA_RELAY_INTERVAL_MILLIS: { kind: 'number', min: 10, default: 500 },
  MENTORA_RELAY_BATCH_SIZE: { kind: 'number', min: 1, max: 500, default: 25 },
  MENTORA_RELAY_CLAIM_MILLIS: { kind: 'number', min: 100, default: 30_000 },
  MENTORA_RELAY_RETRY_BASE_MILLIS: { kind: 'number', min: 1, default: 1_000 },
  MENTORA_RELAY_RETRY_MAX_MILLIS: { kind: 'number', min: 1, default: 60_000 },
  MENTORA_RELAY_RETRY_MAX_ATTEMPTS: { kind: 'number', min: 1, max: 50, default: 8 },
  MENTORA_RELAY_RETRY_JITTER_MILLIS: { kind: 'number', min: 0, default: 250 },
  // PRODUCT parameters (published Policy configuration — governed, journaled
  // changes; carried here as validated data until the product config source
  // exists).
  MENTORA_PRODUCT_RESCHEDULE_MIN_NOTICE_MILLIS: { kind: 'number', min: 0, default: 3_600_000 },
  MENTORA_PRODUCT_RESCHEDULE_MAX_COUNT: { kind: 'number', min: 0, default: 3 },
  MENTORA_PRODUCT_CANCEL_MIN_NOTICE_MILLIS: { kind: 'number', min: 0, default: 3_600_000 },
  /** Comma-separated allowlist for the RATIFIED ProofRequirementPolicy. */
  MENTORA_PRODUCT_PROOF_ACCEPTED_STRENGTHS: { kind: 'string', nonBlank: true, default: 'standard,elevated' },
  /** MFA composition table (Story #111): comma-separated 'a+b=c' entries; empty = none declared. */
  MENTORA_PRODUCT_PROOF_COMPOSITIONS: { kind: 'string', default: 'standard+standard=elevated' },
  /** Account product params (RFC-003 P5): explicit allowlists, nothing more. */
  MENTORA_PRODUCT_REACHABILITY_CHANNELS: { kind: 'string', nonBlank: true, default: 'email,sms' },
  MENTORA_PRODUCT_SUBSCRIPTION_OFFERS: { kind: 'string', nonBlank: true, default: 'offer-basic' },
} as const;

export type ServerConfig = ConfigValues<typeof SERVER_CONFIG_SCHEMA>;

/** A tiny .env reader (KEY=VALUE lines; no vendor dependency) — a ConfigSource. */
export const dotEnvSource = (path: string): ConfigSource => {
  let entries: Record<string, string> = {};
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    entries = Object.fromEntries(
      lines
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
        }),
    );
  } catch {
    entries = {}; // absent .env is lawful — the environment may carry everything.
  }
  return inMemorySource(`dotenv(${path})`, entries);
};

/** Environment first, then .env — the declared precedence. */
export const serverConfigSources = (dotEnvPath = '.env'): readonly ConfigSource[] => [
  environmentSource(),
  dotEnvSource(dotEnvPath),
];

export const loadServerConfig = (
  sources: readonly ConfigSource[],
): Result<ServerConfig, readonly ConfigViolation[]> => loadConfig(SERVER_CONFIG_SCHEMA, sources);
