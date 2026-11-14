// `studio.serve-binds-loopback-with-spa-fallback` (test-criteria.md, issue 3, Flow): Studio's own server,
// `bun run serve` in `studio/` after `bun run build`, serves the built app on 127.0.0.1 only with an SPA fallback,
// refuses a port that is taken, and gives the page the engine port it is started with (requirement 3.1, 4).

import fs from 'node:fs';
import path from 'node:path';

import { expect, freePortExcept, probe, StudioServer, test } from './support';
import { get, listeningAddresses } from './support/listen';
import { Traffic } from './support/traffic';

/** How long `bun run serve` may take to give up on a port that is taken. */
const EXIT_BOUND_MS = 15_000;

test('studio.serve-binds-loopback-with-spa-fallback', async ({ ctx, page, context }) => {
  const taken = [ctx.emulatorPort, ctx.enginePort, ctx.studioPort];

  // Run `bun run serve` with `EMUFORGE_STUDIO_PORT` set to a free port → `http://127.0.0.1:<port>/` and
  // `http://127.0.0.1:<port>/dynamodb/tables` both answer the app; nothing listens on that port on any other address.
  const port = await freePortExcept(ctx.home, taken);
  const studio = await StudioServer.start(ctx, { port });
  const index = fs.readFileSync(path.join(ctx.studioDir, 'dist', 'index.html'), 'utf8');
  for (const route of ['/', '/dynamodb/tables']) {
    const answer = await get(port, route);
    expect(answer, `GET ${route} answers the built index.html`).toEqual({
      status: 200,
      type: expect.stringMatching(/^text\/html/),
      body: index,
    });
  }
  expect(await listeningAddresses(port), `sockets listening on port ${String(port)}`).toEqual([
    `127.0.0.1:${String(port)}`,
  ]);

  // Run it again on the same port while the first runs → it exits non-zero, naming the port.
  const second = StudioServer.spawn(ctx, { port });
  const exit = await second.waitExit(EXIT_BOUND_MS);
  const { stdout, stderr } = second.output();
  expect(exit, `the second server exits within ${String(EXIT_BOUND_MS / 1000)}s`).not.toBeNull();
  expect(exit?.code ?? null, 'its exit code').not.toBe(0);
  expect(exit?.code ?? null, 'its exit code').not.toBeNull();
  expect(`${stdout}\n${stderr}`, 'its output names the port').toMatch(new RegExp(`(?<!\\d)${String(port)}(?!\\d)`));
  expect(await probe(port), 'the first server still listens').toBe('open');
  await studio.stop();

  // Run it with `EMUFORGE_ENGINE_PORT=<p>` → the page sends its engine requests to `http://127.0.0.1:<p>`. Nothing
  // listens on `<p>`: the requests the page sends are what is observed, not their answers.
  const enginePort = await freePortExcept(ctx.home, [...taken, port]);
  const other = await StudioServer.start(ctx, {
    port: await freePortExcept(ctx.home, [...taken, port, enginePort]),
    enginePort,
  });
  const traffic = Traffic.attach(ctx, context, page);
  await page.goto(other.url('/'));
  await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
  const engine = `http://127.0.0.1:${String(enginePort)}`;
  await expect
    .poll(
      () => {
        const notStudio = traffic.requests
          .map((r) => new URL(r.url))
          .filter((url) => url.protocol.startsWith('http') && url.origin !== other.origin);
        return {
          toThatEngine: notStudio.some((url) => url.origin === engine && url.pathname.startsWith('/__emuforge/')),
          elsewhere: notStudio.filter((url) => url.origin !== engine).map((url) => url.origin + url.pathname),
        };
      },
      { timeout: 10_000, message: `engine requests go to ${engine}` },
    )
    .toEqual({ toThatEngine: true, elsewhere: [] });
});
