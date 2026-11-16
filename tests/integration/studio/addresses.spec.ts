// The flow check of issue 60 (test-criteria.md, issue 60, Flow; requirement R5, R7): the engine's and the emulator's
// addresses on Home stay whole in every language from 320 wide, in the built app served by `bun run serve` with an
// engine on a free port of five digits, in front of an emulator of the check's own on a free port of five digits,
// whatever ports the run was given; the emulator is stopped for Home's "emulator stopped" state, then the engine for
// "engine unreachable". Every text of another language is read from the catalogue files of the checkout under test
// at run time; a language is set with a stored choice. Each language and state is one page, resized through the
// widths. Words: `support/addresses.ts`.
//
// `studio.addresses-stay-whole-with-five-digit-ports`.

import type { Page } from '@playwright/test';

import {
  ADDRESS_WIDTHS,
  dashNotInRow,
  firstCommand,
  FIVE_DIGITS,
  fmt,
  notWhole,
  openRows,
  replaceAddress,
  rowsDrawn,
  rowWords,
  sizeAddresses,
  type RowDrawn,
  type RowsDrawn,
  type RowWords,
} from './support/addresses';
import { expect, HOME_STATES, resizeTo, startStack, test, type Ctx, type HomeState, type Stack } from './support';
import { FACES, LANGUAGES } from './support/languages';
import { Lines } from './support/lines';

/** An address no local stack produces, wider than a row at 320 (requirement R5.5). */
const LONG_ADDRESS = 'http://engine.a-host-name-no-local-stack-has.example:65535';

/** The widths of the stacked layout's lines, and of the side-by-side layout's. */
const STACKED_WIDTHS = [320, 390, 640];
const SIDE_BY_SIDE_WIDTHS = [641, 768, 1280];

/** The tolerance of a place, in CSS pixels. */
const PX = 1;

/** At most `n` lines of a list, with how many more there are. */
function cap(list: string[], n = 60): string[] {
  return list.length > n ? [...list.slice(0, n), `… and ${String(list.length - n)} more`] : list;
}

/** The first line of an error's message. */
function first(e: unknown): string {
  return ((e as Error).message ?? String(e)).split('\n')[0];
}

/** Moves the stack into `state`: the check's own emulator stopped, then the engine stopped. */
async function enter(ctx: Ctx, stack: Stack, state: HomeState): Promise<void> {
  if (state === 'emulator stopped') {
    await stack.emulator!.stop();
    ctx.log(`own emulator on port ${String(stack.emulatorPort)} stopped: Home is "emulator stopped"`);
  }
  if (state === 'engine unreachable') {
    await stack.engine.stop();
    ctx.log('engine stopped: Home is "engine unreachable"');
  }
}

/** The row's label with its status beside it on the first line, and its address or "-" on a second line. */
function notTwoLines(row: RowDrawn, second: 'address' | 'dash'): string[] {
  if (row.missing) return [row.missing];
  if (!row.status) return [`the row shows no status word (${JSON.stringify(row.shown)})`];
  const out: string[] = [];
  const l = row.label;
  const s = row.status.box;
  if (!(l.top < s.bottom - PX && s.top < l.bottom - PX)) {
    out.push(`the status (${fmt(s)}) is not on the label's line (${fmt(l)})`);
  } else if (s.left < l.right - PX) {
    out.push(`the status (${fmt(s)}) is not beside the label (${fmt(l)})`);
  }
  const below = Math.max(l.bottom, s.bottom);
  if (second === 'address') {
    const a = row.address;
    if (!a || !a.first) return [...out, `the row shows ${JSON.stringify(row.shown)}, no address`];
    if (a.top < below - PX)
      out.push(`the address (top ${a.top.toFixed(1)}) is not below the label and the status (${below.toFixed(1)})`);
    if (Math.abs(a.first.left - l.left) > PX) {
      out.push(`the address starts at ${a.first.left.toFixed(1)}, the label at ${l.left.toFixed(1)}`);
    }
    if (Math.abs(a.box.width - row.inner.width) > PX) {
      out.push(
        `the address's box ${a.boxIs} is ${a.box.width.toFixed(1)}px wide, the row's inner width ${row.inner.width.toFixed(1)}px`,
      );
    }
  } else {
    const d = row.dash;
    if (!d) return [...out, `the row shows ${JSON.stringify(row.shown)}, no "-"`];
    if (d.box.top < below - PX)
      out.push(`"-" (top ${d.box.top.toFixed(1)}) is not below the label and the status (${below.toFixed(1)})`);
    if (Math.abs(d.box.left - l.left) > PX)
      out.push(`"-" starts at ${d.box.left.toFixed(1)}, the label at ${l.left.toFixed(1)}`);
  }
  return out;
}

/** In the side-by-side layout: the label, the status and the address stacked in that order from one left edge. */
function notStacked(row: RowDrawn): string[] {
  if (row.missing) return [row.missing];
  const a = row.address;
  if (!row.status || !a || !a.first) return [`the row shows ${JSON.stringify(row.shown)}`];
  const out: string[] = [];
  const l = row.label;
  const s = row.status.box;
  if (s.top < l.bottom - PX) out.push(`the status (${fmt(s)}) is not under the label (${fmt(l)})`);
  if (a.top < s.bottom - PX) out.push(`the address (top ${a.top.toFixed(1)}) is not under the status (${fmt(s)})`);
  if (Math.abs(s.left - l.left) > PX)
    out.push(`the status starts at ${s.left.toFixed(1)}, the label at ${l.left.toFixed(1)}`);
  if (Math.abs(a.first.left - l.left) > PX) {
    out.push(`the address starts at ${a.first.left.toFixed(1)}, the label at ${l.left.toFixed(1)}`);
  }
  return out;
}

/** The faces and sizes of `studio/DESIGN.md`, "Status rows": address code 13px, "-" interface 14px, label 14px, status 16px. */
function notOwnFaces(row: RowDrawn, second: 'address' | 'dash'): string[] {
  if (row.missing) return [row.missing];
  const out: string[] = [];
  if (row.labelFace.size !== '14px') out.push(`the label is ${row.labelFace.size}`);
  if (!row.status) out.push(`the row shows no status word (${JSON.stringify(row.shown)})`);
  else if (row.status.face.size !== '16px') out.push(`the status word is ${row.status.face.size}`);
  if (second === 'address') {
    const a = row.address;
    if (!a) out.push(`the row shows ${JSON.stringify(row.shown)}, no address`);
    else {
      if (a.face.family !== FACES.code) out.push(`the address is drawn in ${a.face.families}, not the code face`);
      if (a.face.size !== '13px') out.push(`the address is ${a.face.size}`);
    }
  } else {
    const d = row.dash;
    if (!d) out.push(`the row shows ${JSON.stringify(row.shown)}, no "-"`);
    else {
      if (d.face.family === FACES.code || d.face.families !== row.labelFace.families) {
        out.push(`"-" is drawn in ${d.face.families}, not the interface face (${row.labelFace.families})`);
      }
      if (d.face.size !== '14px') out.push(`"-" is ${d.face.size}`);
    }
  }
  return out;
}

/** The terms and definitions of the rows' list as the accessibility tree reads them, in order. */
function treeItems(snapshot: string): { role: string; text: string }[] {
  const items: { role: string; text: string; indent: number }[] = [];
  let current: { role: string; text: string; indent: number } | null = null;
  const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');
  for (const raw of snapshot.split('\n')) {
    const m = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(?: \[[^\]]*\])*(?::\s*(.*))?$/.exec(raw);
    if (!m) continue;
    const [, space, role, name, inline] = m;
    const indent = space.length;
    if (role === 'term' || role === 'definition') {
      current = { role, text: '', indent };
      items.push(current);
    } else if (current && indent <= current.indent) {
      current = null;
    }
    if (!current) continue;
    for (const piece of [name, inline]) {
      if (piece && piece.trim() !== '') current.text = `${current.text} ${unquote(piece)}`;
    }
  }
  return items.map(({ role, text }) => ({ role, text: text.replace(/\s+/g, ' ').trim() }));
}

/** Why the list's tree is not term "Engine", its definition, term "Emulator", its definition, as `wanted`. */
function treeProblems(snapshot: string, wanted: [string, RegExp, string, RegExp]): string[] {
  const items = treeItems(snapshot);
  const roles = ['term', 'definition', 'term', 'definition'];
  const read = items.map((i) => `${i.role} ${JSON.stringify(i.text)}`).join(', ');
  if (items.length !== 4 || items.some((item, k) => item.role !== roles[k])) return [`the list reads ${read}`];
  const ok =
    items[0].text === wanted[0] &&
    wanted[1].test(items[1].text) &&
    items[2].text === wanted[2] &&
    wanted[3].test(items[3].text);
  return ok ? [] : [`the list reads ${read}`];
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------------------------
// studio.addresses-stay-whole-with-five-digit-ports
// ---------------------------------------------------------------------------------------------------------------

test('studio.addresses-stay-whole-with-five-digit-ports', async ({ ctx, browser, proxy }) => {
  test.setTimeout(3_600_000);
  const stack = await startStack(ctx, {
    ownEmulator: true,
    ownEmulatorMinPort: FIVE_DIGITS,
    engineMinPort: FIVE_DIGITS,
  });
  const engineAddress = stack.engine.url;
  const emulatorAddress = stack.emulator!.endpoint;
  ctx.log(`the rows are expected to show ${engineAddress} and ${emulatorAddress}`);
  const words = new Map<string, RowWords>(LANGUAGES.map((l) => [l.tag, rowWords(ctx, l.tag)]));
  const en = words.get('en')!;
  const lines = new Lines(ctx);
  const found = {
    connected: [] as string[],
    emulatorStopped: [] as string[],
    engineStopped: [] as string[],
    scrolls: [] as string[],
    twoLines: [] as string[],
    dashLine: [] as string[],
    sideBySide: [] as string[],
    dark: [] as string[],
    longAddress: [] as string[],
    enlarged: [] as string[],
    tree: [] as string[],
    labelCentre: [] as string[],
    command: [] as string[],
    faces: [] as string[],
  };
  for (const [name, port] of [
    ['engine', stack.engine.port],
    ['emulator', stack.emulatorPort],
  ] as const) {
    if (String(port).length !== 5) found.connected.push(`the ${name}'s port ${String(port)} does not have five digits`);
  }

  /** The language and state pairs whose first command and accessibility tree were measured. */
  const commandSeen = new Set<string>();
  const treeSeen = new Set<string>();

  const wholeInto = (into: string[], where: string, drawn: RowsDrawn, engine: boolean, emulator: boolean) => {
    if (engine) for (const p of notWhole(drawn.engine, engineAddress)) into.push(`${where} Engine: ${p}`);
    if (emulator) for (const p of notWhole(drawn.emulator, emulatorAddress)) into.push(`${where} Emulator: ${p}`);
  };

  /** The rows' list in the accessibility tree, in English, at 320 and 1280. */
  const tree = async (page: Page, state: HomeState) => {
    const wanted: [string, RegExp, string, RegExp] =
      state === 'connected'
        ? [
            'Engine',
            new RegExp(`^Connected ?${escape(engineAddress)}$`),
            'Emulator',
            new RegExp(`^Connected ?${escape(emulatorAddress)}$`),
          ]
        : [
            'Engine',
            new RegExp(`^Unreachable ?${escape(engineAddress)}$`),
            'Emulator',
            new RegExp(`^(${en.statuses.map(escape).join('|')}) ?Not known$`),
          ];
    treeSeen.add(state);
    for (const width of [320, 1280]) {
      const where = `en / ${state} ${String(width)}`;
      try {
        await resizeTo(page, width);
        const list = page.locator('main dl').filter({ has: page.locator('dt', { hasText: /^\s*Engine\s*$/ }) });
        const snapshot = await list.first().ariaSnapshot({ timeout: 10_000 });
        ctx.log(`${where}: the rows' list in the accessibility tree:\n${snapshot}`);
        for (const p of treeProblems(snapshot, wanted)) found.tree.push(`${where}: ${p}`);
      } catch (e) {
        found.tree.push(`${where}: could not read: ${first(e)}`);
      }
    }
  };

  for (const state of HOME_STATES) {
    await enter(ctx, stack, state);
    const into =
      state === 'connected'
        ? found.connected
        : state === 'emulator stopped'
          ? found.emulatorStopped
          : found.engineStopped;
    for (const l of LANGUAGES) {
      const w = words.get(l.tag)!;
      let home;
      try {
        home = await openRows(ctx, browser, proxy, stack.studio, w, state);
      } catch (e) {
        into.push(`${l.tag} / ${state}: could not open: ${first(e)}`);
        found.scrolls.push(`${l.tag} / ${state}: could not open`);
        continue;
      }
      const expected = {
        engine: engineAddress,
        emulator: state === 'engine unreachable' ? null : emulatorAddress,
      };
      for (const width of ADDRESS_WIDTHS) {
        const where = `${l.tag} / ${state} ${String(width)}`;
        try {
          await resizeTo(home.page, width);
          const drawn = await rowsDrawn(home.page, w, expected);
          if (drawn.pageScrolls) found.scrolls.push(`${where}: the page scrolls sideways`);
          if (state === 'engine unreachable') {
            wholeInto(into, where, drawn, true, false);
            for (const p of dashNotInRow(drawn.emulator)) into.push(`${where} Emulator: ${p}`);
          } else {
            wholeInto(into, where, drawn, true, true);
          }
          if (STACKED_WIDTHS.includes(width)) {
            if (state === 'connected') {
              for (const [name, row] of [
                ['Engine', drawn.engine],
                ['Emulator', drawn.emulator],
              ] as const) {
                for (const p of notTwoLines(row, 'address')) found.twoLines.push(`${where} ${name}: ${p}`);
              }
            }
            if (state === 'engine unreachable') {
              for (const p of notTwoLines(drawn.emulator, 'dash')) found.dashLine.push(`${where} Emulator: ${p}`);
            }
          }
          if (state === 'connected' && SIDE_BY_SIDE_WIDTHS.includes(width)) {
            const a = drawn.engine;
            const b = drawn.emulator;
            if (!a.missing && !b.missing && (Math.abs(a.row.top - b.row.top) > PX || b.row.left < a.row.right - PX)) {
              found.sideBySide.push(
                `${where}: the rows are not side by side (Engine ${fmt(a.row)}, Emulator ${fmt(b.row)})`,
              );
            }
            for (const [name, row] of [
              ['Engine', a],
              ['Emulator', b],
            ] as const) {
              for (const p of notStacked(row)) found.sideBySide.push(`${where} ${name}: ${p}`);
            }
          }
          if (state === 'connected' && width === 320) {
            for (const [name, row] of [
              ['Engine', drawn.engine],
              ['Emulator', drawn.emulator],
            ] as const) {
              if (row.missing) found.labelCentre.push(`${where} ${name}: ${row.missing}`);
              else if (row.overLabel)
                found.labelCentre.push(`${where} ${name}: ${row.overLabel} lies over the label's centre`);
            }
          }
          if (state !== 'emulator stopped' && (width === 320 || width === 1280)) {
            for (const p of notOwnFaces(drawn.engine, 'address')) found.faces.push(`${where} Engine: ${p}`);
            const second = state === 'connected' ? 'address' : 'dash';
            for (const p of notOwnFaces(drawn.emulator, second)) found.faces.push(`${where} Emulator: ${p}`);
          }
          if (state !== 'connected' && width === 390 && ['en', 'ko', 'ja'].includes(l.tag)) {
            commandSeen.add(`${l.tag} / ${state}`);
            const c = await firstCommand(home.page, w);
            ctx.log(
              `${where}: first command ${JSON.stringify(c.text)} at ${c.first ? fmt(c.first) : '-'}, scrolled ${String(c.scrollY)}`,
            );
            if (c.missing) found.command.push(`${where}: ${c.missing}`);
            else if (c.scrollY !== 0) found.command.push(`${where}: the page is scrolled by ${String(c.scrollY)}`);
            else if (c.first && (c.first.top < 0 || c.first.bottom > c.viewport.height)) {
              found.command.push(
                `${where}: the first command ${JSON.stringify(c.text)} starts at ${c.first.top.toFixed(0)}, outside the first ${String(c.viewport.height)}px`,
              );
            }
          }
        } catch (e) {
          into.push(`${where}: could not measure: ${first(e)}`);
        }
      }
      if (l.tag === 'en' && state !== 'emulator stopped') await tree(home.page, state);
      await home.context.close();
    }

    if (state !== 'connected') continue;

    // Dark, English, 320 and 1280.
    try {
      const dark = await openRows(ctx, browser, proxy, stack.studio, en, 'connected', 1280, 'dark');
      const isDark = await dark.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
      if (!isDark) found.dark.push('the page does not see a dark colour scheme');
      for (const width of [320, 1280]) {
        await resizeTo(dark.page, width);
        const drawn = await rowsDrawn(dark.page, en, { engine: engineAddress, emulator: emulatorAddress });
        wholeInto(found.dark, `en / dark ${String(width)}`, drawn, true, true);
      }
      await dark.context.close();
    } catch (e) {
      found.dark.push(`could not measure: ${first(e)}`);
    }

    // An address no local stack produces, English, 320.
    try {
      const long = await openRows(ctx, browser, proxy, stack.studio, en, 'connected', 320);
      await resizeTo(long.page, 320);
      if (!(await replaceAddress(long.page, en.engine, engineAddress, LONG_ADDRESS))) {
        found.longAddress.push(`the Engine row does not draw ${engineAddress}`);
      } else {
        const drawn = await rowsDrawn(long.page, en, { engine: LONG_ADDRESS, emulator: null });
        const row = drawn.engine;
        const a = row.address;
        ctx.log(`the long address is drawn as ${JSON.stringify(a?.lines ?? null)}`);
        if (row.missing) found.longAddress.push(row.missing);
        else if (!a) found.longAddress.push(`the row shows ${JSON.stringify(row.shown)}`);
        else {
          if (a.lines.length < 2)
            found.longAddress.push(`it is on ${String(a.lines.length)} line(s), it does not run onto a further line`);
          if (a.drawn < a.chars)
            found.longAddress.push(`${String(a.chars - a.drawn)} of its ${String(a.chars)} characters are not drawn`);
          if (a.outsideBox > 0)
            found.longAddress.push(`${String(a.outsideBox)} characters are outside its box ${a.boxIs}`);
          if (a.outsideRow > 0) found.longAddress.push(`${String(a.outsideRow)} characters are outside its row`);
          for (const c of a.cutBy) found.longAddress.push(`it is cut by ${c}`);
          for (const c of a.ellipsis) found.longAddress.push(`it is cut with an ellipsis in ${c}`);
        }
        if (drawn.pageScrolls) found.longAddress.push('the page scrolls sideways');
      }
      await long.context.close();
    } catch (e) {
      found.longAddress.push(`could not measure: ${first(e)}`);
    }

    // The addresses' text at 20px, English, 320.
    try {
      const big = await openRows(ctx, browser, proxy, stack.studio, en, 'connected', 320);
      await resizeTo(big.page, 320);
      const sized = await sizeAddresses(big.page, [engineAddress, emulatorAddress], '20px');
      if (sized !== 2) found.enlarged.push(`${String(sized)} of the two addresses were found to size`);
      const drawn = await rowsDrawn(big.page, en, { engine: engineAddress, emulator: emulatorAddress });
      for (const [name, row, address] of [
        ['Engine', drawn.engine, engineAddress],
        ['Emulator', drawn.emulator, emulatorAddress],
      ] as const) {
        const a = row.address;
        ctx.log(`${name} at 20px is drawn as ${JSON.stringify(a?.lines ?? null)}`);
        if (row.missing) {
          found.enlarged.push(`${name}: ${row.missing}`);
          continue;
        }
        if (!a) {
          found.enlarged.push(`${name}: the row shows ${JSON.stringify(row.shown)}`);
          continue;
        }
        const colon = address.lastIndexOf(':');
        const want = [address.slice(0, colon), address.slice(colon)];
        if (JSON.stringify(a.lines) !== JSON.stringify(want)) {
          found.enlarged.push(`${name}: drawn as ${JSON.stringify(a.lines)}, not ${JSON.stringify(want)}`);
        }
        if (a.drawn < a.chars) found.enlarged.push(`${name}: ${String(a.chars - a.drawn)} characters are not drawn`);
        if (a.outsideRow > 0) found.enlarged.push(`${name}: ${String(a.outsideRow)} characters are outside its row`);
        for (const c of a.cutBy) found.enlarged.push(`${name}: it is cut by ${c}`);
        for (const c of a.ellipsis) found.enlarged.push(`${name}: it is cut with an ellipsis in ${c}`);
      }
      if (drawn.pageScrolls) found.enlarged.push('the page scrolls sideways');
      await big.context.close();
    } catch (e) {
      found.enlarged.push(`could not measure: ${first(e)}`);
    }
  }

  for (const state of ['connected', 'engine unreachable'] as const) {
    if (!treeSeen.has(state)) found.tree.push(`en / ${state}: not measured`);
  }
  for (const tag of ['en', 'ko', 'ja']) {
    for (const state of ['emulator stopped', 'engine unreachable']) {
      if (!commandSeen.has(`${tag} / ${state}`)) found.command.push(`${tag} / ${state}: not measured`);
    }
  }

  await lines.line(
    '(regression) With the stack of this check, open `/` in every language, connected, at each of the widths → the Engine row shows `http://127.0.0.1:<engine port>` and the Emulator row `https://127.0.0.1:<emulator port>`, each port of five digits, and both addresses are whole',
    async () => expect(cap(found.connected)).toEqual([]),
  );
  await lines.line(
    'Stop the emulator and wait for "Not started", in every language, at each of the widths → both addresses are still shown and whole',
    async () => expect(cap(found.emulatorStopped)).toEqual([]),
  );
  await lines.line(
    'Stop the engine and wait for "Unreachable", in every language, at each of the widths → the Engine row\'s address is whole, and the Emulator row shows "-" inside its row',
    async () => expect(cap(found.engineStopped)).toEqual([]),
  );
  await lines.line(
    'In each of the three states, in every language, at each of the widths → the page does not scroll sideways',
    async () => expect(cap(found.scrolls)).toEqual([]),
  );
  await lines.line(
    "Connected, in every language → each row has two lines: the label with the status beside it on the first; the address on the second, below both, starting at the label's left edge and with a box as wide as the row's inner width — 320, 390 and 640 wide",
    async () => expect(cap(found.twoLines)).toEqual([]),
  );
  await lines.line(
    "The engine stopped, in every language → the Emulator row's \"-\" is on the row's second line, starting at the label's left edge — 320, 390 and 640 wide",
    async () => expect(cap(found.dashLine)).toEqual([]),
  );
  await lines.line(
    'Connected, in every language → the two rows are side by side, and in each the label, the status and the address are stacked in that order from the same left edge — 641, 768 and 1280 wide',
    async () => expect(cap(found.sideBySide)).toEqual([]),
  );
  await lines.line('Connected, English → both addresses are whole — 320 and 1280 wide, dark', async () =>
    expect(cap(found.dark)).toEqual([]),
  );
  await lines.line(
    "Connected, English, replace the Engine row's drawn address in the open page with `http://engine.a-host-name-no-local-stack-has.example:65535` → the address runs onto a further line inside its own box: every character is drawn, none outside its box or its row, no ellipsis, and the page does not scroll sideways — 320 wide",
    async () => expect(cap(found.longAddress)).toEqual([]),
  );
  await lines.line(
    'Connected, English, set the size of the addresses\' text to 20px in the open page → each address is on two lines, broken just before the ":" of its port, with the port whole on the second line; nothing is outside its row and the page does not scroll sideways — 320 wide',
    async () => expect(cap(found.enlarged)).toEqual([]),
  );
  await lines.line(
    'Connected, then the engine stopped, English → the rows\' list reads in the accessibility tree as term "Engine", its definition (status word, then address), term "Emulator", its definition (status word, then address; "Not known" once the engine is stopped) — 320 and 1280 wide',
    async () => expect(cap(found.tree)).toEqual([]),
  );
  await lines.line(
    "Connected, in every language → the point at the centre of each row's label is the label itself, not a box lying over it — 320 wide",
    async () => expect(cap(found.labelCentre)).toEqual([]),
  );
  await lines.line(
    'The emulator stopped, and then the engine stopped, in English, Korean and Japanese → in each state the first command of the notice under the rows starts within the first screen, without scrolling — 390x844',
    async () => expect(cap(found.command)).toEqual([]),
  );
  await lines.line(
    'Connected and the engine stopped, in every language → the address is drawn in the code face at 13px, "-" in the interface face at 14px, the label at 14px and the status word at 16px, as on `main` (`studio/DESIGN.md`, "Status rows") — 320 and 1280 wide',
    async () => expect(cap(found.faces)).toEqual([]),
  );

  lines.end();
});
