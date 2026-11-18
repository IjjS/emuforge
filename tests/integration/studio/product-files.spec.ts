// The product checks that read files and start no form (issues 34, 437 and 484, test-criteria.md): Compose's
// rendered configuration of the one form; the README's "Start", "Ports" and "Run the
// emulator" parts against the command lines the product checks run (`LINES` and `KEEP_START_LINE` in
// `support/product.ts`, #437 R16); and the line endings of the tracked files an image copies or a container reads.
//
// How the README check reads `README.md`:
// - A part is a heading and everything up to the next heading of the same or a higher level. "Start" is read without
//   the part headed "Ports" when that part is below it, so "Ports" is read on its own and the lines that set the
//   ports are not lines of "Start".
// - A numbered situation is a heading below "Start" whose text begins with a number (`### 3. From a clone, …`,
//   `### Situation 3: …`), or a table row whose first cell begins with one.
// - "In code" is an inline code span or a line of a fenced code block (a leading `$ ` is not part of the line).
// - A `docker compose` line is a line in code that holds `docker compose` followed by an argument anywhere in it
//   (assignments, `cd … &&` or `$env:…;` before it included).
// - A variable is named "with" its default when one paragraph, list item or table row holds both.
// - A sentence is a run of prose, code removed, that ends with `.`, `!` or `?`, or at a blank line.
//
// `engine.product-configuration-names-loopback-and-the-emulator-only`,
// `engine.product-readme-gives-the-commands-the-checks-run`, `engine.product-tracked-files-are-lf-in-every-checkout`.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { EnvError, expect, test } from './support';
import { runAt } from './support/product-inspect';
import {
  commandLine,
  ENGINE_FILES_DIR,
  EMULATOR_FILES_DIR,
  Form,
  KEEP_START_LINE,
  LINES,
  SERVICES,
  startLines,
  STOP_BOUND_MS,
  tail,
} from './support/product';

/** The gateway's configuration file of the forms before issue 484, which the two-container form removes. */
const HAPROXY_CFG = 'infra/emuforge/haproxy.cfg';

/** The files of the forms before issue 437, which the one form removes (#437 R13). */
const REMOVED_FILES = ['docker-compose.linux.yml', 'compose'];


const PORT_VARIABLES: [string, string][] = [
  ['EMULATOR_PORT', '9297'],
  ['EMUFORGE_ENGINE_PORT', '8297'],
  ['EMUFORGE_STUDIO_PORT', '8296'],
];

interface Service {
  command?: string[] | null;
  environment?: Record<string, string | null>;
  ports?: { host_ip?: string; published?: string | number; target?: number }[] | null;
  pull_policy?: string;
  volumes?: { type?: string; source?: string; target?: string; read_only?: boolean }[] | null;
  container_name?: string;
  profiles?: string[] | null;
  user?: string;
  network_mode?: string;
  healthcheck?: { test?: string[] | null; disable?: boolean } | null;
  cap_drop?: string[] | null;
  security_opt?: string[] | null;
  depends_on?: Record<string, { condition?: string }> | null;
}

interface Rendered {
  name?: string;
  services?: Record<string, Service>;
}

test('engine.product-configuration-names-loopback-and-the-emulator-only', async ({ ctx }) => {
  test.setTimeout(10 * STOP_BOUND_MS);
  // The ports and names of a form; nothing is started.
  const form = await Form.create(ctx);
  const env = form.env();
  const render = async (what: string, args: string[], e: Record<string, string>) => {
    const result = await runAt(ctx, ctx.checkout, args, e, STOP_BOUND_MS);
    let rendered: Rendered | null = null;
    try {
      rendered = result.code === 0 ? (JSON.parse(result.stdout) as Rendered) : null;
    } catch {
      rendered = null;
    }
    expect(
      rendered,
      `${what}: ${result.line}: exit 0 and a rendered configuration; output:\n${tail(result)}`,
    ).not.toBeNull();
    return { rendered: rendered ?? {}, stdout: result.stdout };
  };
  const config = ['docker', 'compose', 'config', '--format', 'json'];

  // `docker compose config` with the form's variables → exit 0; the services are exactly emuforge and aws-emulator
  // (#484), none with a profile (a rendering with every profile holds no other service).
  const { rendered: plain } = await render("the form's variables", config, env);
  const services = plain.services ?? {};
  expect(Object.keys(services).sort(), 'the services of the rendering').toEqual([...SERVICES].sort());
  const { rendered: everyProfile } = await render(
    'every profile',
    ['docker', 'compose', '--profile', '*', 'config', '--format', 'json'],
    env,
  );
  expect(Object.keys(everyProfile.services ?? {}).sort(), 'the services of the rendering with every profile').toEqual(
    [...SERVICES].sort(),
  );
  expect(
    Object.entries(everyProfile.services ?? {})
      .filter(([, s]) => (s.profiles ?? []).length > 0)
      .map(([name, s]) => `${name}: ${JSON.stringify(s.profiles)}`),
    'services with a profile',
  ).toEqual([]);

  // The mounts → emuforge one, the volume `emulator`, read-only, at its files' folder; the emulator one, the same
  // volume, at its files' folder; no mount of type bind.
  const mounts = (name: string) =>
    (services[name]?.volumes ?? []).map((v) => ({
      type: v.type,
      source: v.source,
      target: v.target,
      read_only: v.read_only === true,
    }));
  expect(mounts('emuforge'), "emuforge's mounts").toEqual([
    { type: 'volume', source: 'emulator', target: ENGINE_FILES_DIR, read_only: true },
  ]);
  expect(
    mounts('aws-emulator').map(({ type, source, target }) => ({ type, source, target })),
    "the emulator's mounts",
  ).toEqual([{ type: 'volume', source: 'emulator', target: EMULATOR_FILES_DIR }]);
  expect(
    Object.entries(services).flatMap(([name, s]) =>
      (s.volumes ?? []).filter((v) => v.type === 'bind').map((v) => `${name}: ${JSON.stringify(v)}`),
    ),
    'mounts of type bind',
  ).toEqual([]);

  // The ports → exactly two, on emuforge, host address 127.0.0.1, published and target both EMUFORGE_STUDIO_PORT and
  // both EMUFORGE_ENGINE_PORT (#484 R8).
  const ports = Object.entries(services).flatMap(([name, s]) =>
    (s.ports ?? []).map((p) => ({
      service: name,
      host_ip: p.host_ip ?? '',
      published: String(p.published ?? ''),
      target: p.target,
    })),
  );
  expect(
    ports.sort((a, b) => (a.target ?? 0) - (b.target ?? 0)),
    'the published ports of the rendering',
  ).toEqual(
    [form.studioPort, form.enginePort]
      .sort((a, b) => a - b)
      .map((port) => ({ service: 'emuforge', host_ip: '127.0.0.1', published: String(port), target: port })),
  );

  // emuforge's command → `serve --listen-address 0.0.0.0` (#484 R8).
  expect(services.emuforge?.command ?? null, "emuforge's command").toEqual(['serve', '--listen-address', '0.0.0.0']);

  // The emulator's service → user 1000:0, command `-p <EMULATOR_PORT> -t off`, emuforge's network namespace, a
  // healthcheck, every capability dropped, no-new-privileges, no container_name, pull_policy build.
  const emulator = services['aws-emulator'] ?? {};
  expect(
    {
      user: emulator.user ?? null,
      command: emulator.command ?? null,
      network_mode: emulator.network_mode ?? null,
      healthcheck:
        !!emulator.healthcheck && emulator.healthcheck.disable !== true && (emulator.healthcheck.test ?? []).length > 0,
      cap_drop: emulator.cap_drop ?? null,
      no_new_privileges: (emulator.security_opt ?? []).includes('no-new-privileges:true'),
      container_name: emulator.container_name ?? null,
      pull_policy: emulator.pull_policy ?? null,
    },
    "the emulator's service",
  ).toEqual({
    user: '1000:0',
    command: ['-p', String(form.emulatorPort), '-t', 'off'],
    network_mode: 'service:emuforge',
    healthcheck: true,
    cap_drop: ['ALL'],
    no_new_privileges: true,
    container_name: null,
    pull_policy: 'build',
  });

  // The emulator's service → it depends on emuforge being healthy (#484 R8, in place of the engine waiting for the
  // emulator).
  expect(
    emulator.depends_on?.emuforge?.condition ?? null,
    "the emulator's dependency on emuforge",
  ).toBe('service_healthy');

  // HOME removed and USERPROFILE a Windows path → exit 0 and the same rendering, in which that path does not occur.
  // Without HOME, Docker's own settings are where they are with it (DOCKER_CONFIG).
  const withoutHome: Record<string, string> = {
    ...env,
    DOCKER_CONFIG: env.DOCKER_CONFIG ?? path.join(ctx.home, '.docker'),
  };
  delete withoutHome.HOME;
  const profileName = `emuforge-it-userprofile-${randomBytes(4).toString('hex')}`;
  const windows = await render('HOME removed, USERPROFILE a Windows path', config, {
    ...withoutHome,
    USERPROFILE: `C:\\Users\\${profileName}`,
  });
  expect(windows.rendered, 'the rendering with USERPROFILE a Windows path and no HOME').toEqual(plain);
  expect(windows.stdout.includes(profileName), `the rendering names the USERPROFILE folder ${profileName}`).toBe(false);

  // Neither HOME nor USERPROFILE → exit 0 and the same rendering.
  const neither = await render('neither HOME nor USERPROFILE', config, withoutHome);
  expect(neither.rendered, 'the rendering with neither HOME nor USERPROFILE').toEqual(plain);

  // infra/emuforge/haproxy.cfg → absent (#484: no gateway).
  expect(fs.existsSync(path.join(ctx.checkout, HAPROXY_CFG)), `${HAPROXY_CFG} exists`).toBe(false);

  // The checkout's files → no docker-compose.linux.yml and no compose.
  expect(
    REMOVED_FILES.filter((f) => fs.existsSync(path.join(ctx.checkout, f))),
    'files of the forms before issue 437 in the checkout',
  ).toEqual([]);

  // EMULATOR_PORT, EMUFORGE_ENGINE_PORT and EMUFORGE_STUDIO_PORT set (the form's own free ports) → the project's name,
  // the published ports (above) and emuforge's environment follow them, as the check asserts it (issue 34): the
  // environment of emuforge is the three ports and the container's HOME, and its mount is under that HOME.
  expect(plain.name ?? null, 'the project name').toBe(form.project);
  const environment = services.emuforge?.environment ?? {};
  expect(Object.keys(environment).sort(), "the environment of emuforge").toEqual(
    ['EMULATOR_PORT', 'EMUFORGE_ENGINE_PORT', 'EMUFORGE_STUDIO_PORT', 'HOME'].sort(),
  );
  expect(
    [environment.EMULATOR_PORT, environment.EMUFORGE_ENGINE_PORT, environment.EMUFORGE_STUDIO_PORT],
    "the ports in the environment of emuforge",
  ).toEqual([form.emulatorPort, form.enginePort, form.studioPort].map(String));
  expect(
    services.emuforge?.volumes?.[0]?.target,
    "the target of emuforge's mount: the container's HOME/.aws/emulator",
  ).toBe(`${environment.HOME ?? ''}/.aws/emulator`);
});

// --- README ---

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** The headings of a Markdown text, fenced code blocks excluded. */
function headings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  });
  return out;
}

/** The lines of a heading's part: from the heading to the next heading of the same or a higher level. */
function partOf(lines: string[], all: Heading[], heading: Heading): { from: number; to: number } {
  const next = all.find((h) => h.line > heading.line && h.level <= heading.level);
  return { from: heading.line, to: next ? next.line : lines.length };
}

/** A fenced code line as the README check reads it: trimmed, a leading `$ ` dropped. */
function codeLine(line: string): string {
  return line.trim().replace(/^\$\s+/, '');
}

/** The fenced code blocks of a text: the non-empty lines of each. */
function fencedBlocks(text: string): string[][] {
  const out: string[][] = [];
  let block: string[] | null = null;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (block) out.push(block);
      block = block ? null : [];
      continue;
    }
    if (block && codeLine(line) !== '') block.push(codeLine(line));
  }
  return out;
}

/** What is in code: inline code spans and the lines of fenced code blocks. */
function codeOf(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (codeLine(line) !== '') out.push(codeLine(line));
      continue;
    }
    for (const m of line.matchAll(/(`+)([^`]+?)\1/g)) out.push(m[2].trim());
  }
  return out;
}

/** The text with fenced code blocks and inline code spans removed. */
function proseOf(text: string): string {
  let fenced = false;
  return text
    .split('\n')
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .map((line) => line.replace(/(`+)[^`]+?\1/g, ' '))
    .join('\n');
}

/** Paragraphs, list items and table rows, backticks removed: the blocks prose is read in. */
function blocksOf(text: string): string[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  let fenced = false;
  const flush = () => {
    if (paragraph.length > 0) out.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fenced = !fenced;
    } else if (fenced) continue;
    else if (line.trim() === '' || /^\s*#/.test(line)) flush();
    else if (/^\s*\|/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line)) {
      flush();
      if (/^\s*\|/.test(line)) out.push(line);
      else paragraph.push(line);
    } else paragraph.push(line);
  }
  flush();
  return out.map((b) => b.replace(/`/g, ''));
}

/** The sentences of a text's prose. */
function sentencesOf(text: string): string[] {
  return proseOf(text)
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function namesVariableWithDefault(text: string, variable: string, value: string): boolean {
  return blocksOf(text).some(
    (b) => new RegExp(`\\b${variable}\\b`).test(b) && new RegExp(`(^|\\D)${value}(\\D|$)`).test(b),
  );
}

/**
 * The numbered situations of a part, the lines of `skip` left out: headings below the part's own and table rows whose
 * text begins with a number.
 */
function numberedSituations(
  lines: string[],
  all: Heading[],
  start: Heading,
  part: { from: number; to: number },
  skip: { from: number; to: number },
): string[] {
  const numbered = /^(?:\*\*|_)?(?:situation\s+)?[1-9]\b/i;
  const inPart = (i: number) => i > part.from && i < part.to && !(i >= skip.from && i < skip.to);
  const found: string[] = [];
  for (const h of all.filter((h) => inPart(h.line) && h.level > start.level)) {
    if (numbered.test(h.text)) found.push(`heading: ${h.text}`);
  }
  for (let i = part.from; i < part.to; i++) {
    if (!inPart(i)) continue;
    const row = /^\s*\|([^|]*)\|/.exec(lines[i]);
    if (row && numbered.test(row[1].trim().replace(/`/g, ''))) found.push(`row: ${lines[i].trim()}`);
  }
  return found;
}

/** A line in code that holds `docker compose` followed by an argument, whatever comes before it. */
const COMPOSE_LINE = /(^|[\s;&|(])docker compose\s+\S/;

/** A bash line `NAME=value … <command>`: its assignments and its command, or `null`. */
function assignedLine(line: string): { names: string[]; values: string[]; command: string } | null {
  const m = /^((?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+)(\S.*)$/.exec(line);
  if (!m) return null;
  const pairs = m[1]
    .trim()
    .split(/\s+/)
    .map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]);
  return { names: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]), command: m[2].trim() };
}

/** A line of a code block without its trailing comment; `''` for a comment line. */
function withoutComment(line: string): string {
  return line.startsWith('#') ? '' : line.replace(/\s+#.*$/, '').trim();
}

/** A bash line with each leading assignment `NAME=value` spelled `$env:NAME=value;`, as PowerShell sets it. */
function powerShellOf(line: string): string {
  const parsed = assignedLine(line);
  if (!parsed) return line;
  const assignments = parsed.names.map((name, i) => `$env:${name}=${parsed.values[i]};`);
  return [...assignments, parsed.command].join(' ');
}

/** The runtimes "Start" may not name outside its sentence on Windows (#437 R17). */
const OTHER_RUNTIMES = [
  /Rancher/i,
  /Colima/i,
  /OrbStack/i,
  /Podman/i,
  /nerdctl/i,
  /containerd/i,
  /\bLima\b/,
  /minikube/i,
  /Docker Desktop for (?!macOS)/,
];

/** The code lines of "Run the emulator" as they are before issue 437, which it keeps (design section 2.5). */
const RUN_THE_EMULATOR_LINES = [
  "mkdir -p ~/.aws/emulator              # the emulator's folder, made by you before the first start",
  'docker compose -f infra/aws-emulator/docker-compose.yml up -d --build',
  "source infra/aws-emulator/env.sh      # point this shell's AWS CLI and SDKs at the emulator",
  'aws sts get-caller-identity           # Account 000000000000 means you reached the emulator',
  'EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml up -d   # a second emulator beside it',
  'EMULATOR_PORT=9298 docker compose -f infra/aws-emulator/docker-compose.yml down    # stops only that one',
  'docker compose -f infra/aws-emulator/docker-compose.yml down',
];

test('engine.product-readme-gives-the-commands-the-checks-run', async ({ ctx }) => {
  const readme = fs.readFileSync(path.join(ctx.checkout, 'README.md'), 'utf8');
  const lines = readme.split('\n');
  const all = headings(lines);
  const headed = (text: string) => all.find((h) => h.text === text);

  const start = headed('Start');
  expect(start?.text ?? null, 'a part of README.md headed "Start"').toBe('Start');
  const ports = headed('Ports');
  expect(ports?.text ?? null, 'a part of README.md headed "Ports"').toBe('Ports');
  const startRange = start ? partOf(lines, all, start) : { from: 0, to: 0 };
  const portsRange = ports ? partOf(lines, all, ports) : { from: 0, to: 0 };
  const startLinesOfReadme = lines.slice(startRange.from, startRange.to).filter((_, i) => {
    const at = startRange.from + i;
    return !(ports && at >= portsRange.from && at < portsRange.to);
  });
  const startPart = startLinesOfReadme.join('\n');
  const portsPart = lines.slice(portsRange.from, portsRange.to).join('\n');
  ctx.log(
    `"Start" lines ${String(startRange.from + 1)}-${String(startRange.to)}, "Ports" lines ${String(portsRange.from + 1)}-${String(portsRange.to)}`,
  );

  // "Start", its code → the start line and the stop line in one block, http://127.0.0.1:8296/, and of docker compose
  // lines exactly those the product checks run: the start line, the stop line, the emulator's log, the line that
  // removes the volume too and the start line with the variable.
  const startLine = commandLine(LINES.start);
  const stopLine = commandLine(LINES.stop);
  expect(
    fencedBlocks(startPart).some((block) => block.includes(startLine) && block.includes(stopLine)),
    `"Start": one code block that holds ${startLine} and ${stopLine}`,
  ).toBe(true);
  expect(startPart, '"Start": the address').toContain('http://127.0.0.1:8296/');
  const startCode = codeOf(startPart);
  const composeLines = [...new Set(startCode.filter((c) => COMPOSE_LINE.test(c)))];
  expect(composeLines.sort(), '"Start": the docker compose lines in code').toEqual([...startLines()].sort());
  expect(startLines(), 'the line with the variable is among the lines the checks run').toContain(KEEP_START_LINE);

  // "Start" → no ./compose, no --profile, no docker-compose.linux.yml, no mkdir, no EMUFORGE_UID, no numbered situation.
  for (const word of ['./compose', '--profile', 'docker-compose.linux.yml', 'mkdir', 'EMUFORGE_UID']) {
    expect(startPart.includes(word), `"Start" holds ${word}`).toBe(false);
  }
  expect(
    start ? numberedSituations(lines, all, start, startRange, portsRange) : [],
    '"Start": numbered situations',
  ).toEqual([]);

  // "Start", its prose → an emulator of its own is started; its files are in a Docker volume; an AWS client uses the
  // engine's address with any key; a second start line starts afresh; an emulator already running is not used;
  // --remove-orphans for a form of an older clone.
  const startBlocks = blocksOf(startPart);
  const aBlock = (what: string, ...tests: RegExp[]) =>
    expect(
      startBlocks.some((b) => tests.every((t) => t.test(b))),
      `"Start": a paragraph, item or row that says ${what}`,
    ).toBe(true);
  aBlock('an emulator of its own is started', /\bemulator\b/i, /\bown\b/i, /\bstart/i);
  aBlock("the emulator's files are in a Docker volume", /\bemulator/i, /\bfiles?\b/i, /\bDocker volume\b/i);
  aBlock(
    "an AWS client uses the engine's address http://127.0.0.1:8297 with any key",
    /\bAWS\b/,
    /http:\/\/127\.0\.0\.1:8297(?!\d)/,
    /\bany\b[^.]*\bkey/i,
  );
  aBlock('a second start line starts afresh', /\b(second|again|twice)\b/i, /\b(afresh|fresh|recreate[sd]?)\b/i);
  aBlock(
    'an emulator already running is not used',
    /\balready (running|runs?)\b/i,
    /\b(not|neither|never)\b[^.]*\bused\b/i,
  );
  aBlock('--remove-orphans for a form of an older clone', /--remove-orphans/, /\b(older|before)\b/i, /\bclone\b/i);

  // "Start", the runtimes it names → Docker Desktop for macOS and Docker Engine on Linux, and a sentence on Windows
  // (not run yet, or the run's runtime, version and date); no other runtime's name outside that sentence.
  const startProse = proseOf(startPart);
  for (const runtime of ['Docker Desktop for macOS', 'Docker Engine on Linux']) {
    expect(startProse, `"Start": ${runtime}`).toContain(runtime);
  }
  const sentences = sentencesOf(startPart);
  const onWindows = sentences.filter((s) => /\bWindows\b/.test(s));
  ctx.log(`"Start": the sentences on Windows: ${JSON.stringify(onWindows)}`);
  expect(
    onWindows.some(
      (s) => /\bnot\s+(been\s+)?run\s+yet\b/i.test(s) || (/\d+\.\d+/.test(s) && /\b\d{4}-\d{2}-\d{2}\b/.test(s)),
    ),
    '"Start": a sentence that says Windows was not run yet, or names the run\'s runtime, version and date',
  ).toBe(true);
  expect(
    sentences.filter((s) => !/\bWindows\b/.test(s)).filter((s) => OTHER_RUNTIMES.some((r) => r.test(s))),
    '"Start": sentences, other than those on Windows, that name another runtime',
  ).toEqual([]);

  // "Ports" → the three variables with their defaults; a bash block that sets the two published ports for the start
  // line and for the stop line; a PowerShell block whose lines are those bash lines with each assignment spelled
  // `$env:NAME=value;`, and the line with the variable; docker compose logs emuforge; no 18296 or 18297 (#484: no
  // reserved port); no ./compose.
  for (const [name, value] of PORT_VARIABLES) {
    expect(namesVariableWithDefault(portsPart, name, value), `"Ports" names ${name} with ${value}`).toBe(true);
  }
  const blocks = fencedBlocks(portsPart).map((block) => block.map(withoutComment).filter((l) => l !== ''));
  const setsPorts = (line: string, command: string) => {
    const parsed = assignedLine(line);
    return (
      parsed !== null &&
      [...parsed.names].sort().join(' ') === 'EMUFORGE_ENGINE_PORT EMUFORGE_STUDIO_PORT' &&
      parsed.command === command
    );
  };
  const bash = blocks.find(
    (block) => block.some((l) => setsPorts(l, startLine)) && block.some((l) => setsPorts(l, stopLine)),
  );
  expect(
    bash ?? null,
    '"Ports": a code block that sets the two published ports for the start line and the stop line',
  ).not.toBeNull();
  if (bash) {
    const [up, down] = [bash.find((l) => setsPorts(l, startLine)), bash.find((l) => setsPorts(l, stopLine))];
    expect(
      assignedLine(down ?? '')
        ?.names.map((n, i) => `${n}=${assignedLine(down ?? '')?.values[i] ?? ''}`)
        .sort(),
      '"Ports": the stop line sets the ports the start line sets',
    ).toEqual(
      assignedLine(up ?? '')
        ?.names.map((n, i) => `${n}=${assignedLine(up ?? '')?.values[i] ?? ''}`)
        .sort(),
    );
    const keepLine = powerShellOf(KEEP_START_LINE);
    const wanted = [...new Set([...bash.map(powerShellOf), keepLine])].sort();
    const powerShell = blocks.find((block) => block !== bash && block.includes(keepLine));
    expect(powerShell ?? null, `"Ports": a code block that holds ${keepLine}`).not.toBeNull();
    expect(
      [...new Set(powerShell ?? [])].sort(),
      '"Ports": the PowerShell block, the bash lines with $env:NAME=value; and the line with the variable',
    ).toEqual(wanted);
  }
  const portsBlocks = blocksOf(portsPart);
  expect(
    portsBlocks.filter((b) => /(^|\D)1829[67](\D|$)/.test(b)),
    '"Ports": paragraphs, items or rows that name 18296 or 18297',
  ).toEqual([]);
  expect(codeOf(portsPart), '"Ports": docker compose logs emuforge in code').toContain('docker compose logs emuforge');
  expect(portsPart.includes('./compose'), '"Ports" holds ./compose').toBe(false);

  // "Run the emulator" → its lines as before issue 437, and a sentence that it is for the developer's start and was
  // run on macOS and Linux.
  const emulator = headed('Run the emulator');
  expect(emulator?.text ?? null, 'a part of README.md headed "Run the emulator"').toBe('Run the emulator');
  const emulatorRange = emulator ? partOf(lines, all, emulator) : { from: 0, to: 0 };
  const emulatorPart = lines.slice(emulatorRange.from, emulatorRange.to).join('\n');
  expect(fencedBlocks(emulatorPart).flat(), '"Run the emulator": its code lines').toEqual(RUN_THE_EMULATOR_LINES);
  expect(
    sentencesOf(emulatorPart).some(
      (s) => /\bdevelop/i.test(s) && /\bmacOS\b/.test(s) && /\bLinux\b/.test(s) && /\b(run|ran)\b/i.test(s),
    ),
    '"Run the emulator": a sentence that it is for the developer\'s start and was run on macOS and Linux',
  ).toBe(true);
});

// --- Line endings ---

/** What is copied into an image or read in a container (#437 R11). */
const LF_PATHS = ['infra/', 'docker-compose.yml', 'engine/', 'studio/'];

/** The attributes that keep a text file LF in every checkout. */
const LF_ATTRIBUTES = ['text=auto eol=lf', 'text eol=lf'];

test('engine.product-tracked-files-are-lf-in-every-checkout', async ({ ctx }) => {
  // git with the test process's environment, its output not logged (a line per tracked file).
  const git = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd: ctx.checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: STOP_BOUND_MS },
        (error, stdout, stderr) => {
          if (error) reject(new EnvError(`git ${args.join(' ')} in ${ctx.checkout}: ${stderr || error.message}`));
          else resolve(stdout);
        },
      );
    });

  // `git ls-files --eol` for every tracked file under infra/, docker-compose.yml, engine/ and studio/ → each text file
  // `i/lf` with the attribute text=auto eol=lf (or text eol=lf); none `i/crlf` or `i/mixed`.
  const listed = (await git(['ls-files', '--eol', '--', ...LF_PATHS]))
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const m = /^i\/(\S*)\s+w\/(\S*)\s+attr\/(.*?)\s*\t(.*)$/.exec(l);
      return m ? { index: m[1], attr: m[3].trim(), path: m[4] } : { index: '?', attr: '?', path: l };
    });
  ctx.log(`git ls-files --eol: ${String(listed.length)} tracked files`);
  expect(listed.length, 'tracked files under the paths').toBeGreaterThan(0);
  expect(
    listed.filter((f) => f.index === '?').map((f) => f.path),
    'lines of git ls-files --eol the check cannot read',
  ).toEqual([]);
  expect(
    listed.filter((f) => f.index === 'crlf' || f.index === 'mixed').map((f) => `${f.path}: i/${f.index}`),
    'tracked files stored with CRLF or mixed line endings',
  ).toEqual([]);
  expect(
    listed.filter((f) => f.index === 'lf' && !LF_ATTRIBUTES.includes(f.attr)).map((f) => `${f.path}: attr/${f.attr}`),
    'tracked text files without text=auto eol=lf (or text eol=lf)',
  ).toEqual([]);

  // `git check-attr text eol` for a path that does not exist yet under infra/ → text: auto and eol: lf.
  const fresh = `infra/emuforge-it-new-${randomBytes(4).toString('hex')}`;
  expect(fs.existsSync(path.join(ctx.checkout, fresh)), `${fresh} exists`).toBe(false);
  const attrs = (await git(['check-attr', 'text', 'eol', '--', fresh]))
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(l.indexOf(': ') + 2));
  expect(attrs, `git check-attr text eol -- ${fresh}`).toEqual(['text: auto', 'eol: lf']);
});
