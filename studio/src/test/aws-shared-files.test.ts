// Check studio.unit-tests-read-no-aws-shared-files: no Studio unit test reads the AWS shared files under $HOME/.aws/.
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ListStateMachinesCommand, type SFNClient } from '@aws-sdk/client-sfn';
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest';
import { createS3Client, createSfnClient, engineEndpoint } from '../lib/aws/client-factory';

// This file sets AWS_CONFIG_FILE or AWS_SHARED_CREDENTIALS_FILE only in the two cases that say so, and undoes no
// environment stub between tests: whatever restores the redirect between tests is the suite's, not this file's.

type Headers = Record<string, string>;

class RequestCaptured extends Error {
  readonly headers: Headers;

  constructor(headers: Headers) {
    super('request captured before it was sent');
    this.name = 'RequestCaptured';
    this.headers = headers;
  }
}

// Builds the request a command would send and stops it at the last step, so nothing goes on the network.
async function buildRequest(client: S3Client | SFNClient, send: () => Promise<unknown>): Promise<Headers> {
  (client as SFNClient).middlewareStack.add(
    () => (args) => {
      throw new RequestCaptured((args.request as { headers: Headers }).headers);
    },
    { step: 'deserialize', priority: 'low', name: 'captureRequest', override: true },
  );
  try {
    await send();
  } catch (error) {
    if (error instanceof RequestCaptured) {
      return error.headers;
    }
    throw error;
  }
  throw new Error('the command completed without building a request');
}

const endpoint = engineEndpoint(8314);

// The engine's session route, answered in this file's setup (issue #13 D4): the factory asks it before it builds a
// request. Any other fetch rejects as a network failure, so nothing goes on the network.
const SESSION_URL = `${endpoint}/__emuforge/session`;
const SESSION_TOKEN = '0123456789abcdef'.repeat(4);

function answerSessionRoute(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = typeof input === 'object' && 'url' in input ? input : undefined;
  const url = request?.url ?? String(input);
  const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
  if (url === SESSION_URL && method === 'GET') {
    return Promise.resolve(
      new Response(JSON.stringify({ token: SESSION_TOKEN }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.reject(new TypeError('Failed to fetch'));
}

beforeAll(() => {
  vi.stubGlobal('fetch', answerSessionRoute);
});

function buildSfnRequest(): Promise<Headers> {
  const client = createSfnClient({ endpoint });
  return buildRequest(client, () => client.send(new ListStateMachinesCommand({})));
}

function buildS3Request(): Promise<Headers> {
  const client = createS3Client({ endpoint });
  return buildRequest(client, () => client.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' })));
}

const ini = (marker: string) => `[default]\nsdk_ua_app_id = ${marker}\nmax_attempts = 7\n`;

interface Markers {
  config?: string;
  credentials?: string;
}

const markersOf = (name: string): Required<Markers> => ({
  config: `ef11-${name}-config`,
  credentials: `ef11-${name}-credentials`,
});

// import.meta.url as a string: jsdom replaces the global URL, which node:url does not accept.
const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(HERE, '..', '..');
// Scratch directories live in the checkout's ignored output/, never in a shared system directory.
const SCRATCH = join(STUDIO, '..', 'output', 'tests', 'aws-shared-files');

function newScratch(): string {
  mkdirSync(SCRATCH, { recursive: true });
  return mkdtempSync(join(SCRATCH, 'check-'));
}

// A scratch directory for this test, removed when the test ends, pass or fail.
function caseScratch(): string {
  const root = newScratch();
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(path: string, marker: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, ini(marker));
  return path;
}

// A HOME under root whose .aws/ holds the given markers; with none, a HOME without .aws/.
function markerHome(root: string, markers: Markers = {}): string {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  if (markers.config !== undefined) writeFile(join(home, '.aws', 'config'), markers.config);
  if (markers.credentials !== undefined) writeFile(join(home, '.aws', 'credentials'), markers.credentials);
  return home;
}

function expectNoMarker(headers: Headers, markers: string[]): void {
  const sent = JSON.stringify(headers);
  for (const marker of markers) {
    expect(sent, `a header carries marker ${marker}`).not.toContain(marker);
  }
  expect(headers['amz-sdk-request']).toBe('attempt=1; max=3');
}

// The HOME this process started with, from the environment and from the user database.
const STARTING_HOMES = [process.env['HOME'], userInfo().homedir].filter((home): home is string => Boolean(home));

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

// What the file's beforeAll built and read. It records only; each assertion sits in a test of its own.
let early: { headers?: Headers; error?: unknown; config?: string | undefined; credentials?: string | undefined } = {};
const EARLY_MARKERS = markersOf('before-all');

beforeAll(async () => {
  const root = newScratch();
  try {
    vi.stubEnv('HOME', markerHome(root, EARLY_MARKERS));
    early.config = process.env['AWS_CONFIG_FILE'];
    early.credentials = process.env['AWS_SHARED_CREDENTIALS_FILE'];
    early.headers = await buildSfnRequest();
  } catch (error) {
    early = { ...early, error };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('builds a Step Functions request with HOME at marker files, carrying no marker', async () => {
  const markers = markersOf('sfn');
  vi.stubEnv('HOME', markerHome(caseScratch(), markers));

  expectNoMarker(await buildSfnRequest(), [markers.config, markers.credentials]);
});

it('builds an S3 request with HOME at marker files, carrying no marker', async () => {
  const markers = markersOf('s3');
  vi.stubEnv('HOME', markerHome(caseScratch(), markers));

  expectNoMarker(await buildS3Request(), [markers.config, markers.credentials]);
});

it('builds a Step Functions request with a marker only in .aws/credentials, carrying no marker', async () => {
  const marker = markersOf('credentials-only').credentials;
  vi.stubEnv('HOME', markerHome(caseScratch(), { credentials: marker }));

  expectNoMarker(await buildSfnRequest(), [marker]);
});

it("finds no marker in the Step Functions request built in the file's beforeAll", () => {
  if (early.error !== undefined) throw early.error;
  expect(early.headers, 'beforeAll built no request').toBeDefined();

  expectNoMarker(early.headers ?? {}, [EARLY_MARKERS.config, EARLY_MARKERS.credentials]);
});

it('builds a Step Functions request carrying no marker after the test calls vi.unstubAllEnvs()', async () => {
  vi.unstubAllEnvs();
  const markers = markersOf('after-unstub');
  vi.stubEnv('HOME', markerHome(caseScratch(), markers));

  expectNoMarker(await buildSfnRequest(), [markers.config, markers.credentials]);
});

it('finds both shared-file variables naming the same missing absolute path outside every HOME as in beforeAll', () => {
  const config = process.env['AWS_CONFIG_FILE'];
  const credentials = process.env['AWS_SHARED_CREDENTIALS_FILE'];
  const home = markerHome(caseScratch());
  vi.stubEnv('HOME', home);

  expectRedirectTarget('AWS_CONFIG_FILE', config, home);
  expectRedirectTarget('AWS_SHARED_CREDENTIALS_FILE', credentials, home);
  expect(config, "AWS_CONFIG_FILE differs from the file's beforeAll").toBe(early.config);
  expect(credentials, "AWS_SHARED_CREDENTIALS_FILE differs from the file's beforeAll").toBe(early.credentials);
});

// Each "own value" case records the file it named, so the next test can put the marker back at that path and so
// would see it again if the variable still named that file.
const ownFiles: { config?: string; credentials?: string } = {};
const OWN_CONFIG_MARKER = 'ef11-own-x';
const OWN_CREDENTIALS_MARKER = 'ef11-own-z';

// The credentials pair runs first: no cleanup runs between tests, and the SDK caches each shared file by path for
// the whole file, so an AWS_CONFIG_FILE left from the config pair would win over the credentials file here. The
// config file wins over a credentials file left from the credentials pair, so the config pair is unaffected.
it('gives a test that sets AWS_SHARED_CREDENTIALS_FILE itself its own file', async () => {
  const root = caseScratch();
  vi.stubEnv('HOME', markerHome(root));
  ownFiles.credentials = writeFile(join(root, 'own', 'credentials'), OWN_CREDENTIALS_MARKER);
  vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', ownFiles.credentials);

  const headers = await buildSfnRequest();

  expect(headers['user-agent']).toContain(`app/${OWN_CREDENTIALS_MARKER}`);
  expect(headers['amz-sdk-request']).toBe('attempt=1; max=7');
});

it('redirects the next test again after a test set AWS_SHARED_CREDENTIALS_FILE itself', async () => {
  const markers = markersOf('after-own-credentials');
  vi.stubEnv('HOME', markerHome(caseScratch(), markers));
  if (ownFiles.credentials !== undefined) {
    writeFile(ownFiles.credentials, OWN_CREDENTIALS_MARKER);
    const path = ownFiles.credentials;
    onTestFinished(() => rmSync(dirname(dirname(path)), { recursive: true, force: true }));
  }

  expectNoMarker(await buildSfnRequest(), [markers.config, markers.credentials, OWN_CREDENTIALS_MARKER]);
});

it('gives a test that sets AWS_CONFIG_FILE itself its own file', async () => {
  const root = caseScratch();
  vi.stubEnv('HOME', markerHome(root));
  ownFiles.config = writeFile(join(root, 'own', 'config'), OWN_CONFIG_MARKER);
  vi.stubEnv('AWS_CONFIG_FILE', ownFiles.config);

  const headers = await buildSfnRequest();

  expect(headers['user-agent']).toContain(`app/${OWN_CONFIG_MARKER}`);
  expect(headers['amz-sdk-request']).toBe('attempt=1; max=7');
});

it('redirects the next test again after a test set AWS_CONFIG_FILE itself', async () => {
  const markers = markersOf('after-own-config');
  vi.stubEnv('HOME', markerHome(caseScratch(), markers));
  if (ownFiles.config !== undefined) {
    writeFile(ownFiles.config, OWN_CONFIG_MARKER);
    const path = ownFiles.config;
    onTestFinished(() => rmSync(dirname(dirname(path)), { recursive: true, force: true }));
  }

  expectNoMarker(await buildSfnRequest(), [markers.config, markers.credentials, OWN_CONFIG_MARKER]);
});

// Nested runs: a fresh `vitest run` of the fixture alone, with Studio's own config, from a chosen environment.

const FIXTURE = join(HERE, 'aws-shared-files-fixture.test.ts');
const VITEST = join(STUDIO, 'node_modules', 'vitest', 'vitest.mjs');
const FIXTURE_CASES = [
  'builds a Step Functions request with HOME at marker files, carrying no marker and max=3',
  'finds both shared-file variables naming a missing absolute path outside every HOME',
];
// The fixture knows these markers as fixed strings and asserts their absence.
const NESTED_Y = { config: 'ef11-nested-y-config', credentials: 'ef11-nested-y-credentials' };
const NESTED_H = { config: 'ef11-nested-h-config', credentials: 'ef11-nested-h-credentials' };
const NESTED_BOUND_MS = 60_000;
const NESTED_TIMEOUT_MS = 90_000;

interface NestedCase {
  name: string;
  status: string;
  failureMessages: string[];
}

interface NestedRun {
  exitCode: number | null;
  files: string[];
  cases: NestedCase[];
  output: string;
}

interface JsonReport {
  testResults?: { name: string; assertionResults?: { title: string; status: string; failureMessages?: string[] }[] }[];
}

// The outer environment without both variables, plus the case's values, with HOME the scratch directory.
function nestedEnv(home: string, files?: { config: string; credentials: string }): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['AWS_CONFIG_FILE'];
  delete env['AWS_SHARED_CREDENTIALS_FILE'];
  env['HOME'] = home;
  if (files !== undefined) {
    env['AWS_CONFIG_FILE'] = files.config;
    env['AWS_SHARED_CREDENTIALS_FILE'] = files.credentials;
  }
  return env;
}

// Runs the fixture in a process group of its own. When the bound is reached, or the case ends in any way, the
// group is killed and the run is waited for, so no nested run outlives its case.
async function runFixture(root: string, env: NodeJS.ProcessEnv): Promise<NestedRun> {
  const report = join(root, 'report.json');
  const child = spawn(
    process.execPath,
    [VITEST, 'run', FIXTURE, '--config', join(STUDIO, 'vite.config.ts'), '--reporter=json', `--outputFile=${report}`],
    { cwd: STUDIO, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const closed = new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      output += `${String(error)}\n`;
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
  const killGroup = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // the group has already exited
    }
  };
  const stop = async () => {
    killGroup();
    await closed;
  };
  onTestFinished(stop);

  let timedOut = false;
  const bound = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, NESTED_BOUND_MS);
  const exitCode = await closed.finally(() => clearTimeout(bound));
  await stop();
  if (timedOut) {
    throw new Error(`the nested run did not finish within ${String(NESTED_BOUND_MS / 1000)} s:\n${output}`);
  }

  const parsed: JsonReport = existsSync(report) ? (JSON.parse(readFileSync(report, 'utf8')) as JsonReport) : {};
  const results = parsed.testResults ?? [];
  return {
    exitCode,
    output,
    files: results.map((file) => file.name),
    cases: results.flatMap((file) =>
      (file.assertionResults ?? []).map((test) => ({
        name: test.title,
        status: test.status,
        failureMessages: test.failureMessages ?? [],
      })),
    ),
  };
}

function expectFixturePassed(run: NestedRun): void {
  if (run.cases.length === 0) {
    expect.fail(`no case ran in the nested run (exit ${String(run.exitCode)}):\n${run.output}`);
  }
  const notPassed = run.cases.filter((test) => test.status !== 'passed');
  const described = notPassed.map((test) => `${test.name} (${test.status}): ${test.failureMessages.join('\n')}`);
  expect(
    notPassed.map((test) => test.name),
    `nested run cases not passed:\n${described.join('\n')}`,
  ).toEqual([]);
  expect(run.files).toEqual([FIXTURE]);
  expect(run.cases.map((test) => test.name).sort()).toEqual([...FIXTURE_CASES].sort());
  expect(run.exitCode).toBe(0);
}

// Bound: starts a nested Vitest run of the fixture from a shell (issue 11 t1, e98cf2c).
it(
  'passes the fixture in a nested run whose shell names existing shared files with markers',
  async () => {
    const root = caseScratch();
    const home = markerHome(root, NESTED_H);
    const files = {
      config: writeFile(join(root, 'inherited', 'config'), NESTED_Y.config),
      credentials: writeFile(join(root, 'inherited', 'credentials'), NESTED_Y.credentials),
    };

    expectFixturePassed(await runFixture(root, nestedEnv(home, files)));
  },
  NESTED_TIMEOUT_MS,
);

// Bound: starts a nested Vitest run of the fixture from a shell (issue 11 t1, e98cf2c).
it(
  'passes the fixture in a nested run whose shell has neither shared-file variable',
  async () => {
    const root = caseScratch();
    const home = markerHome(root, NESTED_H);

    expectFixturePassed(await runFixture(root, nestedEnv(home)));
  },
  NESTED_TIMEOUT_MS,
);
