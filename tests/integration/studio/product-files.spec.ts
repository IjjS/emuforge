// The product checks that read files and start no form (issue 34, test-criteria.md): Compose's rendered configuration
// of the product form, the gateway's configuration file and the image's build context; and the README's "Start" and
// "Develop" parts against the command lines the product checks run (`COMMANDS` in `support/product.ts`, R20).
//
// How the README check reads `README.md`:
// - A part is a heading and everything up to the next heading of the same or a higher level.
// - In the part headed "Start", a situation is either a heading below "Start" whose text begins with its number
//   (`### 3. From a clone, …`, `### Situation 3: …`), its part being its text, or a table row whose first cell
//   begins with its number, the row being its text.
// - "In code" is an inline code span or a line of a fenced code block (a leading `$ ` is not part of the line).
// - A variable is named "with" its default when one paragraph, list item or table row holds both.
// - A path is a word of code that holds a `/`, is relative (no leading `/`, `~` or `$`) and holds no `<`, `:` or
//   `=`; it and every relative link target are resolved from the checkout's root.
//
// `engine.product-configuration-names-loopback-and-the-emulator-only`,
// `engine.product-readme-gives-the-commands-the-checks-run`.

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './support';
import { composeArgs, runAt } from './support/product-inspect';
import { COMMANDS, commandLine, Form, START_BOUND_MS, STOP_BOUND_MS, tail, type Situation } from './support/product';

/** The gateway's configuration file and the image's ignore file (design section 2). */
const HAPROXY_CFG = 'infra/emuforge/haproxy.cfg';
const DOCKERFILE_IGNORE = 'infra/emuforge/Dockerfile.dockerignore';

const PORT_VARIABLES: [string, string][] = [
  ['EMULATOR_PORT', '9297'],
  ['EMUFORGE_ENGINE_PORT', '8297'],
  ['EMUFORGE_STUDIO_PORT', '8296'],
];

interface Service {
  command?: string[] | null;
  entrypoint?: string[] | null;
  environment?: Record<string, string | null>;
  ports?: { host_ip?: string; published?: string | number; target?: number }[];
  pull_policy?: string;
  volumes?: {
    type?: string;
    source?: string;
    target?: string;
    read_only?: boolean;
  }[];
  container_name?: string;
}

interface Rendered {
  name?: string;
  services?: Record<string, Service>;
}

function base(file: string | undefined): string {
  return path.basename(file ?? '');
}

test('engine.product-configuration-names-loopback-and-the-emulator-only', async ({ ctx }) => {
  test.setTimeout(START_BOUND_MS);
  // The ports and names of a form; nothing is started.
  const form = await Form.create(ctx, { situation: 3 });
  const env = form.env();
  const run = (args: string[], e: Record<string, string>) => runAt(ctx, ctx.checkout, args, e, STOP_BOUND_MS);
  const renderAt = async (args: string[], e: Record<string, string>) => {
    const result = await run(args, e);
    let rendered: Rendered | null = null;
    try {
      rendered = result.code === 0 ? (JSON.parse(result.stdout) as Rendered) : null;
    } catch {
      rendered = null;
    }
    expect(rendered, `${result.line}: the rendered configuration; output:\n${tail(result)}`).not.toBeNull();
    return rendered ?? {};
  };
  const configOf = (situation: Situation) => composeArgs(situation, 'config', '--format', 'json');
  const plain = await renderAt(configOf(3), env);
  const profiled = await renderAt(configOf(4), env);

  // Every `ports` entry of every service, with and without the profile → host address 127.0.0.1.
  const off: string[] = [];
  for (const [which, rendered] of [
    ['without the profile', plain],
    ['with the profile', profiled],
  ] as const) {
    for (const [name, service] of Object.entries(rendered.services ?? {})) {
      for (const p of service.ports ?? []) {
        if (p.host_ip !== '127.0.0.1') off.push(`${which}: ${name} ${JSON.stringify(p)}`);
      }
    }
  }
  expect(off, 'ports entries whose host address is not 127.0.0.1').toEqual([]);

  // The services: gateway, engine, studio, and with the profile aws-emulator; each `pull_policy: build`.
  expect(Object.keys(plain.services ?? {}).sort(), 'the services without the profile').toEqual([
    'engine',
    'gateway',
    'studio',
  ]);
  expect(Object.keys(profiled.services ?? {}).sort(), 'the services with the profile').toEqual([
    'aws-emulator',
    'engine',
    'gateway',
    'studio',
  ]);
  for (const [name, service] of Object.entries(profiled.services ?? {})) {
    expect(service.pull_policy, `pull_policy of ${name}`).toBe('build');
  }

  // The commands of design 2.2, as argument arrays in the Compose file and with no entrypoint of their own: the
  // gateway runs haproxy on haproxy.cfg, the engine emuforge-server, Studio `bun --no-install …/scripts/serve.ts`.
  const services = plain.services ?? {};
  const gateway = services.gateway?.command ?? [];
  const at = gateway.indexOf('-f');
  expect(
    {
      program: base(gateway[0]),
      config: at >= 0 ? base(gateway[at + 1]) : null,
    },
    `the gateway's command ${JSON.stringify(gateway)}`,
  ).toEqual({ program: 'haproxy', config: 'haproxy.cfg' });
  const engine = services.engine?.command ?? [];
  expect(engine.map(base), `the engine's command ${JSON.stringify(engine)}`).toEqual(['emuforge-server']);
  const studio = services.studio?.command ?? [];
  expect(
    {
      program: base(studio[0]),
      noInstall: studio[1],
      script: studio.length === 3 && studio[2].endsWith('/scripts/serve.ts'),
    },
    `Studio's command ${JSON.stringify(studio)}`,
  ).toEqual({ program: 'bun', noInstall: '--no-install', script: true });
  for (const name of ['gateway', 'engine', 'studio']) {
    expect(services[name]?.entrypoint ?? null, `the entrypoint of ${name}`).toBeNull();
  }
  const composeFile = fs.existsSync(path.join(ctx.checkout, 'docker-compose.yml'))
    ? fs.readFileSync(path.join(ctx.checkout, 'docker-compose.yml'), 'utf8')
    : '';
  const commandLines = composeFile
    .split('\n')
    .map((line, i) => ({
      line: line.replace(/\s+#.*$/, ''),
      next: composeFile.split('\n')[i + 1] ?? '',
    }))
    .filter(({ line }) => /^\s*command:/.test(line));
  expect(commandLines.length, 'command keys in docker-compose.yml').toBeGreaterThan(0);
  expect(
    commandLines
      .filter(({ line, next }) => {
        const value = line.replace(/^\s*command:\s*/, '');
        return !(value.startsWith('[') || (value === '' && /^\s*-\s/.test(next)));
      })
      .map(({ line }) => line.trim()),
    'command keys of docker-compose.yml that are not an argument array',
  ).toEqual([]);

  // No host path but engine's one: a read-only bind of $HOME/.aws/emulator.
  const hostDir = path.join(form.home, '.aws', 'emulator');
  expect(services.gateway?.volumes ?? [], "the gateway's volumes").toEqual([]);
  expect(services.studio?.volumes ?? [], "Studio's volumes").toEqual([]);
  const volumes = services.engine?.volumes ?? [];
  expect(
    volumes.map((v) => ({
      type: v.type,
      source: v.source,
      read_only: v.read_only === true,
    })),
    "the engine's volumes",
  ).toEqual([{ type: 'bind', source: hostDir, read_only: true }]);

  // The environment of gateway, engine and studio → the three ports and the container's HOME, nothing else.
  const homes = new Set<string>();
  for (const name of ['gateway', 'engine', 'studio']) {
    const environment = services[name]?.environment ?? {};
    expect(Object.keys(environment).sort(), `the environment of ${name}`).toEqual(
      ['EMULATOR_PORT', 'EMUFORGE_ENGINE_PORT', 'EMUFORGE_STUDIO_PORT', 'HOME'].sort(),
    );
    expect(
      [environment.EMULATOR_PORT, environment.EMUFORGE_ENGINE_PORT, environment.EMUFORGE_STUDIO_PORT],
      `the ports in the environment of ${name}`,
    ).toEqual([form.emulatorPort, form.enginePort, form.studioPort].map(String));
    homes.add(environment.HOME ?? '');
  }
  const [home] = [...homes];
  expect([...homes], 'HOME of the three services').toHaveLength(1);
  expect(volumes[0]?.target, "the target of the engine's bind: the container's HOME/.aws/emulator").toBe(
    `${home}/.aws/emulator`,
  );

  // The gateway's configuration file: exactly three `server` lines, two to 127.0.0.1 and one to
  // host.docker.internal, each on a port of one of the three variables; `mode tcp` throughout; no `ssl`, `verify` or
  // `resolvers`; `noreuseport` in `global`.
  const cfgPath = path.join(ctx.checkout, HAPROXY_CFG);
  expect(fs.existsSync(cfgPath), `${HAPROXY_CFG} exists`).toBe(true);
  const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
  const lines = cfg
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l !== '');
  const servers = lines
    .filter((l) => /^server\s/.test(l))
    .map((l) => {
      const address = (l.split(/\s+/)[2] ?? '').replace(/"/g, '');
      const colon = address.lastIndexOf(':');
      return { host: address.slice(0, colon), port: address.slice(colon + 1) };
    });
  expect(servers.map((s) => s.host).sort(), `the server lines of ${HAPROXY_CFG}`).toEqual([
    '127.0.0.1',
    '127.0.0.1',
    'host.docker.internal',
  ]);
  const variable = /^\$\{(EMULATOR_PORT|EMUFORGE_ENGINE_PORT|EMUFORGE_STUDIO_PORT)\}$/;
  expect(
    servers.filter((s) => !variable.test(s.port)).map((s) => `${s.host}:${s.port}`),
    `server lines of ${HAPROXY_CFG} whose port is not one of the three variables`,
  ).toEqual([]);
  // Sections and the mode each proxy runs in (its own `mode`, else that of the `defaults` before it).
  let section = '';
  let defaultsMode = '';
  const modes: { section: string; mode: string }[] = [];
  let current: { section: string; mode: string } | null = null;
  const globalLines: string[] = [];
  for (const l of lines) {
    const header = /^(global|defaults|frontend|backend|listen)\b/.exec(l);
    if (header) {
      section = l;
      current = null;
      if (header[1] === 'defaults') defaultsMode = '';
      if (['frontend', 'backend', 'listen'].includes(header[1])) {
        current = { section: l, mode: defaultsMode };
        modes.push(current);
      }
      continue;
    }
    const mode = /^mode\s+(\S+)/.exec(l)?.[1];
    if (mode && section.startsWith('defaults')) defaultsMode = mode;
    if (mode && current) current.mode = mode;
    if (section === 'global') globalLines.push(l);
  }
  expect(modes.length, `proxies in ${HAPROXY_CFG}`).toBeGreaterThan(0);
  expect(
    modes.filter((m) => m.mode !== 'tcp').map((m) => `${m.section}: ${m.mode || 'no mode'}`),
    `proxies of ${HAPROXY_CFG} not in mode tcp`,
  ).toEqual([]);
  expect(
    lines.filter((l) => /(^|\s)(ssl|verify|resolvers)(\s|$)/.test(l)),
    `lines of ${HAPROXY_CFG} with ssl, verify or resolvers`,
  ).toEqual([]);
  expect(globalLines, `the global section of ${HAPROXY_CFG}`).toContain('noreuseport');

  // The image's build context: a build with the checkout's root as its context and the form's ignore file lists
  // what it received → every path under engine/ or studio/, none under engine/target, studio/node_modules,
  // studio/dist or an output directory.
  const ignore = path.join(ctx.checkout, DOCKERFILE_IGNORE);
  expect(fs.existsSync(ignore), `${DOCKERFILE_IGNORE} exists`).toBe(true);
  if (fs.existsSync(ignore)) {
    const scratch = path.join(ctx.tmp, `context-${String(Date.now())}`);
    const out = path.join(scratch, 'received');
    fs.mkdirSync(scratch, { recursive: true });
    ctx.own({
      dispose: async () => fs.rmSync(scratch, { recursive: true, force: true }),
    });
    // A Dockerfile-specific ignore file is `<Dockerfile>.dockerignore` beside the Dockerfile, as the form's is.
    const dockerfile = path.join(scratch, 'context.Dockerfile');
    fs.writeFileSync(dockerfile, 'FROM scratch\nCOPY . /\n');
    fs.copyFileSync(ignore, `${dockerfile}.dockerignore`);
    const listed = await run(
      ['docker', 'build', '--progress', 'plain', '-f', dockerfile, '--output', `type=local,dest=${out}`, ctx.checkout],
      env,
    );
    expect(listed.code, `${listed.line}: exit code; output:\n${tail(listed)}`).toBe(0);
    const received: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        received.push(path.relative(out, full).split(path.sep).join('/'));
        if (fs.lstatSync(full).isDirectory()) walk(full);
      }
    };
    walk(out);
    ctx.log(`the build context holds ${String(received.length)} paths`);
    // A context that received nothing would hold no wrong path either; the image is built from these two.
    expect(received, 'the build context').toEqual(expect.arrayContaining(['engine/Cargo.toml', 'studio/package.json']));
    const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
    expect(
      received.filter(
        (p) =>
          !(under(p, 'engine') || under(p, 'studio')) ||
          under(p, 'engine/target') ||
          under(p, 'studio/node_modules') ||
          under(p, 'studio/dist') ||
          p.split('/').includes('output'),
      ),
      'paths of the build context outside engine/ and studio/ or under what a host build writes',
    ).toEqual([]);
  }

  // With EMULATOR_PORT=9298 → the project name and the emulator's container name differ from those of the
  // emulator's own Compose file for 9298.
  const at9298: Record<string, string> = { ...env, EMULATOR_PORT: '9298' };
  delete at9298.EMUFORGE_ENGINE_PORT;
  delete at9298.EMUFORGE_STUDIO_PORT;
  const product9298 = await renderAt(configOf(4), at9298);
  const emulator9298 = await renderAt(
    ['docker', 'compose', '-f', 'infra/aws-emulator/docker-compose.yml', 'config', '--format', 'json'],
    Object.fromEntries(Object.entries(at9298).filter(([name]) => !name.startsWith('EMUFORGE_'))) as Record<
      string,
      string
    >,
  );
  const names = (r: Rendered) => ({
    project: r.name ?? '',
    emulator: r.services?.['aws-emulator']?.container_name ?? '',
  });
  const [mine, theirs] = [names(product9298), names(emulator9298)];
  ctx.log(
    `EMULATOR_PORT=9298: the product form ${JSON.stringify(mine)}, the emulator's file ${JSON.stringify(theirs)}`,
  );
  expect(mine.project, 'the product form project name for 9298').not.toBe('');
  expect(mine.emulator, "the product form's emulator container name for 9298").not.toBe('');
  expect(mine.project, "the project name for 9298, against the emulator's file").not.toBe(theirs.project);
  expect(mine.emulator, "the emulator's container name for 9298, against the emulator's file").not.toBe(
    theirs.emulator,
  );
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
function partOf(lines: string[], all: Heading[], heading: Heading): { from: number; to: number; text: string } {
  const next = all.find((h) => h.line > heading.line && h.level <= heading.level);
  const to = next ? next.line : lines.length;
  return {
    from: heading.line,
    to,
    text: lines.slice(heading.line, to).join('\n'),
  };
}

/** What is in code: inline code spans and the lines of fenced code blocks (a leading `$ ` dropped). */
function codeOf(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      const code = line.trim().replace(/^\$\s+/, '');
      if (code !== '') out.push(code);
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

function hasFence(text: string): boolean {
  return text.split('\n').some((line) => /^\s*(```|~~~)/.test(line));
}

/** Paragraphs, list items and table rows: the blocks a variable is named "with" its default in. */
function blocksOf(text: string): string[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim() === '' || /^\s*(```|~~~)/.test(line)) flush();
    else if (/^\s*\|/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line)) {
      flush();
      if (/^\s*\|/.test(line)) out.push(line);
      else paragraph.push(line);
    } else paragraph.push(line);
  }
  flush();
  return out.map((b) => b.replace(/`/g, ''));
}

function namesVariableWithDefault(text: string, variable: string, value: string): boolean {
  return blocksOf(text).some(
    (b) => new RegExp(`\\b${variable}\\b`).test(b) && new RegExp(`(^|\\D)${value}(\\D|$)`).test(b),
  );
}

/** The situations of the "Start" part, in the order they appear: their number and their text. */
function situationsOf(lines: string[], all: Heading[], start: Heading): { n: number; text: string }[] {
  const part = partOf(lines, all, start);
  const found: { n: number; line: number; text: string }[] = [];
  const numbered = /^(?:\*\*|_)?(?:situation\s+)?([1-9])\b/i;
  for (const h of all.filter((h) => h.line > part.from && h.line < part.to && h.level > start.level)) {
    const m = numbered.exec(h.text);
    if (m)
      found.push({
        n: Number(m[1]),
        line: h.line,
        text: partOf(lines, all, h).text,
      });
  }
  for (let i = part.from; i < part.to; i++) {
    const row = /^\s*\|([^|]*)\|/.exec(lines[i]);
    if (!row) continue;
    const m = numbered.exec(row[1].trim().replace(/`/g, ''));
    if (m) found.push({ n: Number(m[1]), line: i, text: lines[i] });
  }
  return found.sort((a, b) => a.line - b.line).map(({ n, text }) => ({ n, text }));
}

test('engine.product-readme-gives-the-commands-the-checks-run', async ({ ctx }) => {
  const readmePath = path.join(ctx.checkout, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const lines = readme.split('\n');
  const all = headings(lines);
  const headed = (text: string) => all.find((h) => h.text === text);

  // The part headed "Start" → six situations in the owner's order; 3 and 4 hold, in code, the start and stop command
  // lines of the product checks, and http://127.0.0.1:8296/.
  const start = headed('Start');
  expect(start?.text ?? null, 'a part of README.md headed "Start"').toBe('Start');
  const startPart = start ? partOf(lines, all, start).text : '';
  const situations = start ? situationsOf(lines, all, start) : [];
  expect(
    situations.map((s) => s.n),
    'the situations of "Start", in order',
  ).toEqual([1, 2, 3, 4, 5, 6]);
  const situation = (n: number) => situations.find((s) => s.n === n)?.text ?? '';
  for (const n of [3, 4] as const) {
    const code = codeOf(situation(n));
    for (const which of ['start', 'stop'] as const) {
      const line = commandLine(COMMANDS[n][which]);
      expect(code, `situation ${String(n)}: the ${which} command line in code`).toContain(line);
    }
    expect(situation(n), `situation ${String(n)}: the address`).toContain('http://127.0.0.1:8296/');
  }

  // Situations 1, 2, 5 and 6 → not available yet, one line on what each will be, and no command.
  for (const n of [1, 2, 5, 6]) {
    const text = situation(n);
    const prose = proseOf(text);
    expect(prose, `situation ${String(n)}: says it is not available yet`).toMatch(/not available yet/i);
    if (n <= 2) {
      expect(prose, `situation ${String(n)}: a released version`).toMatch(/releas/i);
      expect(prose, `situation ${String(n)}: installed with a shell command`).toMatch(/shell command/i);
    } else {
      expect(prose, `situation ${String(n)}: the CLI`).toMatch(/\bCLI\b/);
      expect(text, `situation ${String(n)}: the emuforge CLI`).toMatch(/\bemuforge\b/);
    }
    expect(hasFence(text), `situation ${String(n)}: a code block`).toBe(false);
    expect(
      codeOf(text).filter((c) => /\s/.test(c)),
      `situation ${String(n)}: command lines in code`,
    ).toEqual([]);
  }

  // Situation 4 → it is stopped with its own command.
  expect(proseOf(situation(4)), 'situation 4: stopped with its own command').toMatch(/\bown\b[^.]*\bcommand\b/i);

  // "Start" → the three variables with their defaults, 18296 and 18297, Docker with Compose as what it needs,
  // Docker Desktop as the runtime it was verified on, reached from the same machine only.
  for (const [variable, value] of PORT_VARIABLES) {
    expect(namesVariableWithDefault(startPart, variable, value), `"Start" names ${variable} with ${value}`).toBe(true);
  }
  for (const reserved of ['18296', '18297']) {
    expect(startPart, `"Start" names ${reserved}`).toMatch(new RegExp(`(^|\\D)${reserved}(\\D|$)`));
  }
  const startProse = proseOf(startPart);
  expect(startProse, '"Start": what it needs').toMatch(/\bneed/i);
  expect(startPart, '"Start": Docker with Compose').toMatch(/Docker\b[\s\S]*\bCompose\b/);
  expect(startProse, '"Start": verified on Docker Desktop').toMatch(
    /verified[\s\S]*Docker Desktop|Docker Desktop[\s\S]*verified/i,
  );
  expect(startProse, '"Start": reached from the same machine only').toMatch(/same machine/i);

  // The part headed "Develop" → a separate part with `cargo run --bin emuforge-server` and `bun run serve`, the three
  // variables with their defaults and the engine's flags; "Run the emulator" is still there.
  const develop = headed('Develop');
  expect(develop?.text ?? null, 'a part of README.md headed "Develop"').toBe('Develop');
  if (develop && start) {
    const [s, d] = [partOf(lines, all, start), partOf(lines, all, develop)];
    expect(
      {
        developInStart: develop.line > s.from && develop.line < s.to,
        startInDevelop: start.line > d.from && start.line < d.to,
      },
      '"Develop" and "Start" are separate parts',
    ).toEqual({ developInStart: false, startInDevelop: false });
  }
  const developPart = develop ? partOf(lines, all, develop).text : '';
  const developCode = codeOf(developPart);
  for (const command of ['cargo run --bin emuforge-server', 'bun run serve']) {
    expect(
      developCode.some((c) => c.includes(command)),
      `"Develop" holds ${command} in code`,
    ).toBe(true);
  }
  for (const [variable, value] of PORT_VARIABLES) {
    expect(namesVariableWithDefault(developPart, variable, value), `"Develop" names ${variable} with ${value}`).toBe(
      true,
    );
  }
  for (const flag of ['--port', '--emulator-port', '--studio-port']) {
    expect(developPart, `"Develop" names ${flag}`).toMatch(new RegExp(`(^|[^\\w-])${flag}(?![\\w-])`));
  }
  expect(headed('Run the emulator')?.text ?? null, 'a part of README.md headed "Run the emulator"').toBe(
    'Run the emulator',
  );

  // Every link and path in README.md → exists in the checkout, and none points under docs/.
  const targets: string[] = [];
  for (const m of proseOf(readme).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) targets.push(m[1]);
  for (const m of readme.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) targets.push(m[1]);
  const links = targets
    .filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#'))
    .map((t) => t.split('#')[0]);
  const paths = codeOf(readme)
    .flatMap((c) => c.split(/\s+/))
    .map((w) => w.replace(/^["'(]+|["'),;.]+$/g, ''))
    .filter((w) => w.includes('/') && !/^[/~$]/.test(w) && !/[<:=]/.test(w));
  const checked = [...new Set([...links, ...paths])];
  ctx.log(`README.md links and paths: ${checked.join(' ')}`);
  expect(
    checked.filter((p) => !fs.existsSync(path.join(ctx.checkout, p))),
    'links and paths of README.md that do not exist in the checkout',
  ).toEqual([]);
  expect(
    checked.filter((p) => /^(\.\/)?docs(\/|$)/.test(p)),
    'links and paths of README.md under docs/',
  ).toEqual([]);
});
