// The flow check of issue 18 (test-criteria.md, issue 18, Integration checks; requirement R4.1, R4.3): the notice
// Home shows when the emulator is killed, read in Studio's own elements in the order they are drawn, in front of a
// real engine started for the served Studio and an emulator of the check's own on a port of five digits, so the
// container name is as long as it gets (`emuforge-emulator-<5 digits>`).
//
// `studio.home-kill-notice-stop-step-names-container`.

import type { Page } from '@playwright/test';

import { directHealth, expect, startStack, test } from './support';
import { connectionView, layoutIssues, noticeItems, type NoticeItem } from './support/home';
import { Lines } from './support/lines';

/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** The heading of the notice of a killed emulator. */
const KILLED_NOTICE = 'The engine cannot reach the emulator';

/** The lowest port of five digits (requirement R4.3). */
const FIVE_DIGITS = 10_000;

/** `https://127.0.0.1:<port>`, not followed by another digit. */
function emulatorEndpoint(port: number): RegExp {
  return new RegExp(`https://127\\.0\\.0\\.1:${String(port)}(?!\\d)`);
}

/** Step 1's label as requirement R4.1 words it for `connection_refused`. */
function stopStepLabel(port: number): string {
  return `1. Stop what is left of the emulator (the container emuforge-emulator-${String(port)}, which step 2 starts)`;
}

/** The notice's texts and commands, without its buttons: what a reader reads from top to bottom. */
function readable(items: NoticeItem[] | null): Exclude<NoticeItem, { kind: 'button' }>[] {
  return (items ?? []).filter((i): i is Exclude<NoticeItem, { kind: 'button' }> => i.kind !== 'button');
}

/** The text item that is step 1's label (it starts with `1. `), or `null`. */
function stepOne(items: NoticeItem[] | null): Extract<NoticeItem, { kind: 'text' }> | null {
  return (
    readable(items).find(
      (i): i is Extract<NoticeItem, { kind: 'text' }> => i.kind === 'text' && /^1\. /.test(i.text),
    ) ?? null
  );
}

async function killedNotice(page: Page): Promise<NoticeItem[] | null> {
  return noticeItems(page, KILLED_NOTICE);
}

test('studio.home-kill-notice-stop-step-names-container', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true, ownEmulatorMinPort: FIVE_DIGITS });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const container = `emuforge-emulator-${String(port)}`;
  ctx.log(`own emulator on port ${String(port)}: the notice is expected to name ${container}`);

  // The Given: Home open at `/` with both rows "Connected" before the kill.
  await page.goto('/');
  await expect
    .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS, message: 'both rows "Connected"' })
    .toMatchObject({
      engine: { status: 'Connected' },
      emulator: { status: 'Connected', text: expect.stringMatching(emulatorEndpoint(port)) },
    });

  await emulator.kill();
  const lines = new Lines(ctx);

  await lines.line(
    "(regression) Kill the check's emulator while Home is open → within 10 seconds the Emulator row shows \"Unreachable\", step 1's label reads exactly `1. Stop what is left of the emulator (the container emuforge-emulator-<port>, which step 2 starts)`, and a direct call to the emulator's `/__admin/health` gets no answer",
    async () => {
      await expect
        .poll(
          async () => ({
            emulator: (await connectionView(page)).emulator?.status ?? null,
            stepOneLabel: stepOne(await killedNotice(page))?.text ?? null,
          }),
          { timeout: CHANGE_BOUND_MS },
        )
        .toEqual({ emulator: 'Unreachable', stepOneLabel: stopStepLabel(port) });
      // No answer is a connection refused or reset, or no answer within `directHealth`'s 5 seconds. Any other
      // outcome (an HTTP answer, a TLS or protocol error from something that answered, a missing `ca.pem` so the call
      // was never made) is shown as it is.
      const health = await directHealth(ctx.home, port);
      expect(
        typeof health === 'string' && /ECONNREFUSED|ECONNRESET|socket hang up|no answer within 5 s/.test(health)
          ? 'no answer'
          : health,
        "a direct call to the emulator's /__admin/health",
      ).toBe('no answer');
    },
  );

  await lines.line(
    'The same notice → nothing in it reads "command below"; directly under step 1\'s label is the stop command `docker rm -f \\` / `  emuforge-emulator-<port>`, then `2. Start the emulator on port <port>`, then the start command, whose lines set `P=<port>` and name the container `emuforge-emulator-$P`; the container named in step 1\'s label is the one in the stop command',
    async () => {
      const items = await killedNotice(page);
      expect(items, `the notice "${KILLED_NOTICE}"`).not.toBeNull();
      const notice = (await connectionView(page)).notice;
      const texts = readable(items);
      const at = texts.findIndex((i) => i.kind === 'text' && /^1\. /.test(i.text));
      const label = at >= 0 ? texts[at] : undefined;
      const stop = texts[at + 1];
      const stepTwo = texts[at + 2];
      const start = texts[at + 3];
      const labelText = label?.kind === 'text' ? label.text : '';
      const stopLines = stop?.kind === 'command' ? stop.lines : null;
      const startLines = start?.kind === 'command' ? start.lines : [];
      expect({
        readsCommandBelow: /command below/i.test(notice),
        stepOneLabelShown: label !== undefined,
        underStepOne: stopLines,
        stopCommandBelowLabel: label !== undefined && stop !== undefined && stop.top >= label.bottom - 1,
        thenStepTwo: stepTwo?.kind === 'text' ? stepTwo.text : null,
        thenStartCommand: start?.kind === 'command',
        startSetsPort: startLines.some((l) => l.trim() === `P=${String(port)}`),
        startNamesContainer: startLines.some((l) => /(^|\s)emuforge-emulator-\$P(\s|$)/.test(l)),
        containerInLabel: /emuforge-emulator-\d+/.exec(labelText)?.[0] ?? null,
        containerInStopCommand: /emuforge-emulator-\d+/.exec((stopLines ?? []).join('\n'))?.[0] ?? null,
      }).toEqual({
        readsCommandBelow: false,
        stepOneLabelShown: true,
        underStepOne: ['docker rm -f \\', `  ${container}`],
        stopCommandBelowLabel: true,
        thenStepTwo: `2. Start the emulator on port ${String(port)}`,
        thenStartCommand: true,
        startSetsPort: true,
        startNamesContainer: true,
        containerInLabel: container,
        containerInStopCommand: container,
      });
    },
  );

  await lines.line(
    "The same notice → the page does not scroll sideways, no line of either command wraps, and `emuforge-emulator-<port>` in step 1's label sits on one line — 1280 wide and 390 wide",
    async () => {
      const found: string[] = [];
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        const where = `${String(width)} wide`;
        // The notice is drawn again at the new width; wait until it shows step 1's label.
        await expect
          .poll(async () => stepOne(await killedNotice(page)) !== null, {
            timeout: CHANGE_BOUND_MS,
            message: `${where}: the notice shows step 1's label`,
          })
          .toBe(true);
        if ((await layoutIssues(page, [])).pageScrolls) found.push(`${where}: the page scrolls sideways`);
        const items = await killedNotice(page);
        const texts = readable(items);
        const at = texts.findIndex((i) => i.kind === 'text' && /^1\. /.test(i.text));
        const commands = texts
          .slice(at + 1)
          .filter((i) => i.kind === 'command')
          .slice(0, 2);
        if (commands.length < 2) found.push(`${where}: fewer than two commands after step 1's label`);
        for (const command of commands) {
          if (command.kind !== 'command') continue;
          const source = command.lines.map((l) => l.trim()).filter((l) => l !== '');
          if (JSON.stringify(command.drawn) !== JSON.stringify(source)) {
            found.push(`${where}: a command line wraps: drawn ${JSON.stringify(command.drawn)}`);
          }
        }
        const label = stepOne(items);
        if (!label?.text.includes(container)) {
          found.push(`${where}: step 1's label does not name ${container}: ${JSON.stringify(label?.text ?? null)}`);
        } else if (!label.drawn.some((l) => l.includes(container))) {
          found.push(`${where}: ${container} in step 1's label is broken across lines: ${JSON.stringify(label.drawn)}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});
