// The Rust files in one worktree may be older than a cached build from another.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './support';
import { freshHome } from './support/product';
import { docker } from './support/product-inspect';

const BUILD_TIMEOUT_MS = 600_000;

test('engine.product-build-runs-current-worktree-code', async ({ ctx }) => {
  test.setTimeout(3 * BUILD_TIMEOUT_MS + 120_000);
  const root = freshHome(ctx);
  const archive = path.join(root, 'context.tar');
  // Snapshot the live checkout once so both builds include pending source and Dockerfile edits.
  // Omit bulky host outputs before copying. Buildx applies the checkout's Dockerfile.dockerignore at build time.
  execFileSync('tar', [
    '-cf',
    archive,
    '-C',
    ctx.checkout,
    '--exclude=engine/target',
    '--exclude=studio/node_modules',
    '--exclude=studio/dist',
    '--exclude=output',
    '--exclude=.impeccable',
    'engine',
    'studio',
    'infra/emuforge',
  ]);

  const run = randomUUID();
  for (const revision of ['a', 'b']) {
    const dir = path.join(root, revision);
    fs.mkdirSync(dir);
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    const main = path.join(dir, 'engine/crates/emuforge/src/main.rs');
    const source = fs.readFileSync(main, 'utf8');
    const entry = 'fn main() -> ExitCode {';
    expect(source).toContain(entry);
    fs.writeFileSync(main, source.replace(entry, entry + ' eprintln!("' + run + '-' + revision + '");'));
    if (revision === 'a') fs.utimesSync(main, new Date('2020-01-01'), new Date('2020-01-01'));
  }

  for (const [index, revision] of ['a', 'b', 'a'].entries()) {
    const dir = path.join(root, revision);
    // Vary the COPY layer even on the return to A while keeping the builder's Cargo mounts warm.
    fs.writeFileSync(path.join(dir, 'engine/.issue-594-build-input'), run + '-' + index);
    const tag = 'emuforge-it-cache-' + run + ':' + index;
    ctx.own({
      dispose: async () => {
        await docker(['image', 'rm', tag]);
      },
    });
    const build = await docker(
      [
        'buildx',
        'build',
        '--load',
        '--progress=plain',
        '-f',
        path.join(dir, 'infra/emuforge/Dockerfile'),
        '-t',
        tag,
        dir,
      ],
      BUILD_TIMEOUT_MS,
    );
    const log = build.stdout + '\n' + build.stderr;
    ctx.log(log);
    expect(build.ok, log).toBe(true);
    expect(log).toMatch(/Finished .release. profile/);
    const cli = await docker(['run', '--pull', 'never', '--rm', '--network', 'none', tag, '--version']);
    expect(cli.ok, cli.stderr).toBe(true);
    expect(cli.stderr).toBe(run + '-' + revision);
  }
});
