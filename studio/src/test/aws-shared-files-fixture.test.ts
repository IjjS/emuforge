// The test file that studio.unit-tests-read-no-aws-shared-files starts in its nested Vitest runs. It also runs in the
// normal suite as one more file that sets neither AWS_CONFIG_FILE nor AWS_SHARED_CREDENTIALS_FILE.
/// <reference types="node" />
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { isAbsolute, join, normalize, sep } from 'node:path';
import process from 'node:process';
import { ListStateMachinesCommand, type SFNClient } from '@aws-sdk/client-sfn';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createSfnClient, engineEndpoint } from '../lib/aws/client-factory';

type Headers = Record<string, string>;

class RequestCaptured extends Error {
  readonly headers: Headers;

  constructor(headers: Headers) {
    super('request captured before it was sent');
    this.name = 'RequestCaptured';
    this.headers = headers;
  }
}

// Builds the ListStateMachines request a factory client would send and stops it at the last step, so nothing goes on
// the network.
async function buildSfnRequest(): Promise<Headers> {
  const client: SFNClient = createSfnClient({ endpoint: engineEndpoint(8314) });
  client.middlewareStack.add(
    () => (args) => {
      throw new RequestCaptured((args.request as { headers: Headers }).headers);
    },
    { step: 'deserialize', priority: 'low', name: 'captureRequest', override: true },
  );
  try {
    await client.send(new ListStateMachinesCommand({}));
  } catch (error) {
    if (error instanceof RequestCaptured) {
      return error.headers;
    }
    throw error;
  }
  throw new Error('the command completed without building a request');
}

// The markers the check's nested runs write: Y in the files both variables name, H under the nested run's HOME.
const NESTED_MARKERS = [
  'ef11-nested-y-config',
  'ef11-nested-y-credentials',
  'ef11-nested-h-config',
  'ef11-nested-h-credentials',
];
const OWN_MARKERS = { config: 'ef11-fixture-config', credentials: 'ef11-fixture-credentials' };

// The HOME this process started with, from the environment and from the user database.
const STARTING_HOMES = [process.env['HOME'], userInfo().homedir].filter((home): home is string => Boolean(home));

const ini = (marker: string) => `[default]\nsdk_ua_app_id = ${marker}\nmax_attempts = 7\n`;

// A scratch HOME for this test, removed when the test ends, pass or fail.
function scratchHome(markers?: { config: string; credentials: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'emuforge-studio-aws-shared-files-fixture-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home);
  if (markers !== undefined) {
    mkdirSync(join(home, '.aws'));
    writeFileSync(join(home, '.aws', 'config'), ini(markers.config));
    writeFileSync(join(home, '.aws', 'credentials'), ini(markers.credentials));
  }
  return home;
}

function isUnder(path: string, dir: string): boolean {
  const base = normalize(dir).replace(/\/+$/, '');
  const target = normalize(path);
  return target === base || target.startsWith(base + sep);
}

function expectRedirectTarget(name: string, value: string | undefined, stubbedHome: string): void {
  if (value === undefined || value === '') {
    expect.fail(`${name} is ${value === undefined ? 'unset' : 'empty'}`);
  }
  expect(value.startsWith('~/'), `${name}=${value} starts with ~/`).toBe(false);
  expect(isAbsolute(value), `${name}=${value} is not an absolute path`).toBe(true);
  expect(existsSync(value), `${name}=${value} exists`).toBe(false);
  for (const home of [...STARTING_HOMES, stubbedHome]) {
    expect(isUnder(value, home), `${name}=${value} lies under ${home}`).toBe(false);
  }
}

it('builds a Step Functions request with HOME at marker files, carrying no marker and max=3', async () => {
  vi.stubEnv('HOME', scratchHome(OWN_MARKERS));

  const headers = await buildSfnRequest();

  const sent = JSON.stringify(headers);
  for (const marker of [OWN_MARKERS.config, OWN_MARKERS.credentials, ...NESTED_MARKERS]) {
    expect(sent, `a header carries marker ${marker}`).not.toContain(marker);
  }
  expect(headers['amz-sdk-request']).toBe('attempt=1; max=3');
});

it('finds both shared-file variables naming a missing absolute path outside every HOME', () => {
  const config = process.env['AWS_CONFIG_FILE'];
  const credentials = process.env['AWS_SHARED_CREDENTIALS_FILE'];
  const home = scratchHome();
  vi.stubEnv('HOME', home);

  expectRedirectTarget('AWS_CONFIG_FILE', config, home);
  expectRedirectTarget('AWS_SHARED_CREDENTIALS_FILE', credentials, home);
});
