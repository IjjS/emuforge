// What the checks of issue 54's wrapper and Linux file need besides `product.ts`: a new, empty `HOME` of the check's
// own, the entries under a directory, what the wrapper printed, the user and group ids of a container's processes,
// and a run of the wrapper inside a container of the product image with no network and no Docker client.
//
// "It prints `<line>`" (test-criteria.md, shared terms): the wrapper's standard error holds the line `+ <line>` and
// no other line that starts with `+ `. `printed` returns those lines; a check compares them with
// `[`+ ${line}`]`.

import fs from 'node:fs';
import path from 'node:path';

import { EnvError, type Ctx } from './check';
import { dockerRead, type CommandResult } from './product';
import { docker, runAt } from './product-inspect';

/** A new, empty directory under the run's output, removed when the check ends (after the forms it holds). */
export function freshHome(ctx: Ctx): string {
  const home = path.join(ctx.tmp, `home-${ctx.id}-${String(Date.now())}`);
  fs.mkdirSync(home, { recursive: true });
  ctx.own({ dispose: async () => fs.rmSync(home, { recursive: true, force: true }) });
  return home;
}

/** Every path under `root`, relative and sorted. */
export function entries(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      out.push(path.relative(root, full));
      if (fs.lstatSync(full).isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

/** The `.aws` entries under `home`: `.aws` itself and every path below it. */
export function awsEntries(home: string): string[] {
  return entries(home).filter((entry) => entry === '.aws' || entry.startsWith('.aws/'));
}

/** The lines of the wrapper's standard error that start with `+ `. */
export function printed(result: CommandResult): string[] {
  return result.stderr.split('\n').filter((line) => line.startsWith('+ '));
}

/** The user id and group id of every process of a container (`docker top`). */
export async function processIds(containerId: string): Promise<{ uid: string; gid: string; args: string }[]> {
  const top = await dockerRead(['top', containerId, '-eo', 'uid,gid,args']);
  return top
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [uid, gid, ...args] = line.split(/\s+/);
      return { uid, gid, args: args.join(' ') };
    });
}

/** How long one run of the wrapper in a container may take: it refuses before it runs anything. */
const IN_CONTAINER_BOUND_MS = 60_000;

/** Where the checkout's `compose` is mounted in the container, and the container's working directory. */
const IN_CONTAINER_DIR = '/emuforge';

let containers = 0;

/**
 * Runs `bash -c '<line>'` in a new container of the run's product image: as `user`, with `env` added to the image's
 * environment, no network, the checkout's `compose` mounted read-only at `/emuforge/compose` when the checkout has
 * one, and `/emuforge` as its working directory. The image holds no Docker client. The container is removed when
 * it exits, and by name when the check ends. Its exit code and streams are those of `docker run`, which are the
 * container's. `EnvError` when the run did not name its product image.
 */
export async function wrapperInContainer(
  ctx: Ctx,
  user: string,
  line: string,
  env: Record<string, string> = {},
): Promise<CommandResult> {
  if (!ctx.productImage) {
    throw new EnvError('EMUFORGE_IT_PRODUCT_IMAGE is not set; run the suite with tests/integration/run');
  }
  containers += 1;
  const name = `emuforge-it-wrapper-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${String(containers)}`;
  ctx.own({
    dispose: async () => {
      await docker(['rm', '-f', name]);
    },
  });
  const script = path.join(ctx.checkout, 'compose');
  const args = ['docker', 'run', '--rm', '--name', name, '--network', 'none', '--user', user, '-w', IN_CONTAINER_DIR];
  if (fs.existsSync(script)) {
    args.push('--mount', `type=bind,source=${script},target=${IN_CONTAINER_DIR}/compose,readonly`);
  }
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  args.push(ctx.productImage, 'bash', '-c', line);
  const hostEnv: Record<string, string> = { HOME: ctx.home, PATH: process.env.PATH ?? '/usr/bin:/bin' };
  for (const key of ['DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
    const value = process.env[key];
    if (value) hostEnv[key] = value;
  }
  return runAt(ctx, ctx.checkout, args, hostEnv, IN_CONTAINER_BOUND_MS);
}
