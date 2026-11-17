// The seed of the structure score and the critique of a bucket's page, "Create bucket", "Empty bucket" and "Delete
// bucket" (issue 256, requirement R13): what the four specs under `studio/references/console/s3/` name by their routes.
// Not a check: the `pm` runs it against the emulator of a run, from the repository root, before `pm-structure`:
//
//   NODE_PATH=studio/node_modules bun tests/integration/studio/services/s3/s3-seed-structure.ts <emulator port> [--empty]
//
// - Seeded (default): `structure-bucket`, made with Object Lock (so versioning `Enabled`), two tags, ABAC `Enabled`,
//   default encryption `aws:kms` with the ARN of a KMS key the seed makes and the bucket key on, one
//   Intelligent-Tiering configuration, logging to `structure-logs`, EventBridge on, transfer acceleration `Enabled`, a
//   default retention of 1 day in governance mode, request payment `Requester`, a website configuration and two
//   objects; `structure-logs` and `structure-empty-bucket`, plain (nothing set after `CreateBucket`) and holding
//   nothing. No event notification, so no queue.
// - `--empty`: `structure-empty-bucket` alone, for the empty captures of the critique (R13: an emulator that holds that
//   bucket and nothing else).
//
// The emulator must hold none of these buckets yet (a fresh emulator): the seed refuses otherwise, so two seeded runs
// hold the same. Every call goes straight to the emulator on 127.0.0.1, signed with the key it wrote for that port
// under `$HOME/.aws/emulator/<port>/`, TLS verified against its `ca.pem`; no other file under `~/.aws` is read and
// no key is printed. Each call's status is printed; the first that fails ends the seed with exit code 1.

import os from 'node:os';

import {
  bucketNamesDirect,
  configureBucketDirect,
  createBucketDirect,
  createKeyDirect,
  putObjectDirect,
  shownDirect,
  type Direct,
  type DirectEnv,
} from './s3';

/** The buckets of the seed, by the names the specs' routes use (R13). */
export const STRUCTURE_BUCKET = 'structure-bucket';
export const STRUCTURE_LOGS = 'structure-logs';
export const STRUCTURE_EMPTY_BUCKET = 'structure-empty-bucket';

/** The two objects of `structure-bucket`. */
export const STRUCTURE_OBJECTS: [string, string][] = [
  ['index.html', '<html><body>structure</body></html>'],
  ['data/report.csv', 'name,value\nstructure,1\n'],
];

function must(answer: Direct, what: string, log: (line: string) => void): void {
  log(`${what}: ${shownDirect(answer)}`);
  if ('error' in answer || answer.status !== 200) throw new Error(`${what} answered ${shownDirect(answer)}`);
}

/**
 * Makes the seed of R13 on the emulator on `port` (`empty`: `structure-empty-bucket` alone), logging each call with
 * `log`. Throws on the first call that fails, and before any call when the emulator already holds one of the buckets.
 */
export async function seedStructure(
  env: DirectEnv,
  port: number,
  empty: boolean,
  log: (line: string) => void,
): Promise<void> {
  const names = empty ? [STRUCTURE_EMPTY_BUCKET] : [STRUCTURE_BUCKET, STRUCTURE_LOGS, STRUCTURE_EMPTY_BUCKET];
  const held = (await bucketNamesDirect(env, port, 'structure-')).filter((n) => names.includes(n));
  if (held.length > 0) throw new Error(`the emulator already holds ${held.join(', ')}; seed a fresh emulator`);

  for (const name of empty ? [STRUCTURE_EMPTY_BUCKET] : [STRUCTURE_LOGS, STRUCTURE_EMPTY_BUCKET]) {
    must(await createBucketDirect(env, port, name), `CreateBucket ${name}`, log);
  }
  if (empty) return;

  const keyArn = await createKeyDirect(env, port, 'EmuForge structure seed');
  log(`KMS CreateKey: ${keyArn}`);
  must(
    await createBucketDirect(env, port, STRUCTURE_BUCKET, { objectLock: true }),
    `CreateBucket ${STRUCTURE_BUCKET} with Object Lock`,
    log,
  );
  await configureBucketDirect(
    env,
    port,
    STRUCTURE_BUCKET,
    {
      abac: 'Enabled',
      tags: [
        ['team', 'structure'],
        ['env', 'test'],
      ],
      encryption: { algorithm: 'aws:kms', keyId: keyArn, bucketKey: true },
      intelligentTiering: [
        { id: 'archive-reports', status: 'Enabled', prefix: 'data/', archiveDays: 90, deepArchiveDays: 180 },
      ],
      logging: { targetBucket: STRUCTURE_LOGS, targetPrefix: 'logs/' },
      notifications: { eventBridge: true },
      accelerate: 'Enabled',
      defaultRetention: { mode: 'GOVERNANCE', days: 1 },
      website: { indexDocument: 'index.html', errorDocument: 'error.html' },
    },
    log,
  );
  for (const [key, body] of STRUCTURE_OBJECTS) {
    must(await putObjectDirect(env, port, STRUCTURE_BUCKET, key, body), `PutObject ${STRUCTURE_BUCKET}/${key}`, log);
  }
  // Last: once the bucket's payer is the requester, a call that does not say it pays is the owner's own.
  await configureBucketDirect(env, port, STRUCTURE_BUCKET, { requestPayer: 'Requester' }, log);
}

async function main(argv: string[]): Promise<number> {
  const args = argv.filter((a) => a !== '--empty');
  const port = Number(args[0]);
  if (args.length !== 1 || !/^\d+$/.test(args[0]) || port < 1 || port > 65535) {
    console.error('usage: s3-seed-structure.ts <emulator port> [--empty]');
    return 2;
  }
  try {
    await seedStructure({ home: os.homedir() }, port, argv.includes('--empty'), (line) => console.log(line));
    console.log('seeded');
    return 0;
  } catch (e) {
    console.error(`seed failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
