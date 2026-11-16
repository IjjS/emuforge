// The flow checks of issue 32 on wrapping (test-criteria.md, issue 32, Flow; requirement R1, R4): Korean words whole
// in the bar and the page, and a count kept on one line with its unit, in the built app served by `bun run serve`, in
// front of a real engine started for that Studio and an emulator of the check's own, stopped for Home's "emulator
// stopped" state, then the engine stopped for "engine unreachable". Every text of another language is read from the
// catalogue files of the checkout under test at run time; no check names a message key. A language is set with a
// stored choice in the browser context's storage state. Each language and state is one page, resized through the
// widths. Words: `support/wrapping.ts`.
//
// `studio.korean-words-stay-whole`, `studio.count-and-unit-stay-on-one-line`.

import type { Page } from '@playwright/test';

import {
  areaRootStyle,
  countedMessages,
  drawnOutside,
  elementStyles,
  expect,
  hangulSplits,
  HOME_STATES,
  longWordDrawn,
  measureCounted,
  noticeHeadingStyle,
  openHome,
  resizeTo,
  startStack,
  styledTexts,
  test,
  waitFor,
  WRAP_WIDTHS,
  type CountedMessage,
  type Ctx,
  type HomeState,
  type Stack,
} from './support';
import { ACTION, frame } from './support/frame';
import { areaRootLang, LANGUAGES, languageMenu, layout, openMenu } from './support/languages';
import { layerReport } from './support/layers';
import { Lines } from './support/lines';

/** How long a page of the AWS area or Studio's "Page not found" may take to show once opened. */
const SHOW_BOUND_MS = 10_000;

/** A Korean word wider than the page's column at 390 wide (the column is 358px): 42 syllables, no white space. */
const LONG_KOREAN_WORD = '가나다라마바사아자차카타파하'.repeat(3);

/** At most `n` lines of a list, with how many more there are. */
function cap(list: string[], n = 40): string[] {
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

/** The bar and the page of Studio's frame. */
function barAndPage(page: Page) {
  return [frame(page).banner, page.getByRole('main')];
}

// ---------------------------------------------------------------------------------------------------------------
// studio.korean-words-stay-whole
// ---------------------------------------------------------------------------------------------------------------

test('studio.korean-words-stay-whole', async ({ ctx, browser, proxy }) => {
  test.setTimeout(1_800_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const messages = countedMessages(
    ctx,
    LANGUAGES.map((l) => l.tag),
  );
  const recheck = messages.find((m) => m.states.includes('emulator stopped') && !m.states.includes('connected'))!;
  const lines = new Lines(ctx);
  const found = {
    whole: [] as string[],
    layout: [] as string[],
    notFound: [] as string[],
    longWord: [] as string[],
    otherInKorean: [] as string[],
    koreanInGerman: [] as string[],
    wrapKorean: [] as string[],
    wrapOthers: [] as string[],
    normal: [] as string[],
    area: [] as string[],
  };
  const areaWordBreak = new Map<string, string | null>();

  /** Korean words and layout of the page as drawn now, at every width, into `splits` and `into`. */
  const sweep = async (page: Page, where: string, splits: string[], into: string[], withLayout: boolean) => {
    for (const width of WRAP_WIDTHS) {
      const at = `${where} ${String(width)}`;
      try {
        await resizeTo(page, width);
        const s = await hangulSplits(page, barAndPage(page));
        if (s.pairs === 0) splits.push(`${at}: no Korean text in the bar or the page`);
        for (const split of s.splits) splits.push(`${at}: ${split} is on two lines`);
        const l = await layout(page);
        if (l.pageScrolls) into.push(`${at}: the page scrolls sideways`);
        if (withLayout) for (const i of l.issues) into.push(`${at}: ${i}`);
      } catch (e) {
        splits.push(`${at}: could not measure: ${first(e)}`);
      }
    }
  };

  /** `/aws` in `tag`: `word-break` at the area's root, and the rules of the `studio` layer that reach the area. */
  const area = async (page: Page, tag: string) => {
    try {
      await page.goto('/aws');
      const shown = await waitFor(SHOW_BOUND_MS, async () => ((await areaRootLang(page)) !== null ? true : undefined));
      if (!shown) throw new Error('no AWS area on the page within 10s');
      areaWordBreak.set(tag, await areaRootStyle(page, 'word-break'));
      const report = await layerReport(page, true);
      if (report.root === null) found.area.push(`${tag} /aws: no area root`);
      for (const r of report.studioInside) found.area.push(`${tag} /aws: a rule of the studio layer matches ${r}`);
    } catch (e) {
      found.area.push(`${tag} /aws: could not measure: ${first(e)}`);
    }
  };

  /** Every text of the bar and the page whose language is not Korean, and the two elements: `word-break` normal. */
  const normalOutsideKorean = async (page: Page, where: string) => {
    const items = [
      ...(await elementStyles(frame(page).banner, 'word-break')),
      ...(await elementStyles(page.getByRole('main'), 'word-break')),
    ];
    for (const scope of barAndPage(page)) items.push(...(await styledTexts(scope, 'word-break')));
    for (const i of items) {
      if (i.lang.toLowerCase() === 'ko') continue;
      if (i.value !== 'normal')
        found.normal.push(`${where}: ${i.where} "${i.text}" (${i.lang}): word-break ${i.value}`);
    }
  };

  // Connected.
  {
    const ko = await openHome(ctx, browser, proxy, stack.studio, 'ko', 'connected', messages);
    await sweep(ko.page, 'ko / connected', found.whole, found.layout, true);

    try {
      await resizeTo(ko.page, 390);
      const d = await longWordDrawn(ko.page, LONG_KOREAN_WORD);
      if (d.lines < 2) found.longWord.push(`the word takes ${String(d.lines)} line(s), it does not break`);
      if (d.outside > 0) found.longWord.push(`${String(d.outside)} of its characters are drawn outside its box`);
      if (d.pageScrolls) found.longWord.push('the page scrolls sideways');
    } catch (e) {
      found.longWord.push(`could not measure: ${first(e)}`);
    }

    try {
      await resizeTo(ko.page, 1280);
      await openMenu(ko.page);
      const texts = await styledTexts(languageMenu(ko.page), 'word-break');
      const others = texts.filter((t) => t.lang.toLowerCase() !== 'ko');
      for (const l of LANGUAGES.filter((x) => x.tag !== 'ko')) {
        if (!others.some((t) => t.text === l.name)) found.otherInKorean.push(`the menu has no option "${l.name}"`);
      }
      for (const t of others) {
        if (t.value !== 'normal') {
          found.otherInKorean.push(`menu: ${t.where} "${t.text}" (${t.lang}): word-break ${t.value}`);
        }
      }
      await ko.page.keyboard.press('Escape');
    } catch (e) {
      found.otherInKorean.push(`the menu in Korean: could not measure: ${first(e)}`);
    }

    try {
      await ko.page.goto('/does-not-exist');
      await ko.page.locator('main h1').first().waitFor({ state: 'visible', timeout: ACTION.timeout });
      await sweep(ko.page, 'ko /does-not-exist', found.notFound, found.notFound, false);
    } catch (e) {
      found.notFound.push(`ko /does-not-exist: could not open: ${first(e)}`);
    }
    await area(ko.page, 'ko');
    await ko.context.close();

    for (const tag of ['de', 'ja', 'th', 'en']) {
      const h = await openHome(ctx, browser, proxy, stack.studio, tag, 'connected', messages);
      if (tag === 'de') {
        try {
          await openMenu(h.page);
          const texts = await styledTexts(languageMenu(h.page), 'word-break');
          const korean = texts.filter((t) => t.text === '한국어');
          if (korean.length === 0) found.koreanInGerman.push('the menu has no option "한국어"');
          for (const t of korean) {
            if (t.value !== 'keep-all') found.koreanInGerman.push(`"한국어" (${t.lang}): word-break ${t.value}`);
          }
          await h.page.keyboard.press('Escape');
          const own = (await styledTexts(h.page.getByRole('main'), 'word-break')).filter(
            (t) => t.lang.toLowerCase() === 'de',
          );
          if (own.length === 0) found.koreanInGerman.push('the page has no text of its own in German');
          for (const t of own) {
            if (t.value !== 'normal') found.koreanInGerman.push(`page: ${t.where} "${t.text}": word-break ${t.value}`);
          }
        } catch (e) {
          found.koreanInGerman.push(`could not measure: ${first(e)}`);
        }
      }
      try {
        await resizeTo(h.page, 390);
        await normalOutsideKorean(h.page, `${tag} / 390`);
      } catch (e) {
        found.normal.push(`${tag} / 390: could not measure: ${first(e)}`);
      }
      if (tag === 'en') await area(h.page, 'en');
      await h.context.close();
    }
  }

  // The engine's English message (provisional, see `support/wrapping.ts`): the emulator killed, then started again.
  {
    const emulator = stack.emulator!;
    await emulator.kill();
    try {
      const ko = await openHome(ctx, browser, proxy, stack.studio, 'ko', 'emulator stopped', messages);
      const englishOf = async () =>
        (await styledTexts(ko.page.getByRole('main'), 'word-break')).filter(
          (t) => t.explicit && t.lang.toLowerCase() === 'en',
        );
      const english =
        (await waitFor(SHOW_BOUND_MS, async () => {
          const shown = await englishOf();
          return shown.length > 0 ? shown : undefined;
        })) ?? [];
      if (english.length === 0) found.otherInKorean.push("Home shows no text marked as the engine's English");
      for (const t of english) {
        if (t.value !== 'normal') found.otherInKorean.push(`page: ${t.where} "${t.text}" (en): word-break ${t.value}`);
      }
      await ko.context.close();
    } catch (e) {
      found.otherInKorean.push(`the engine's message: could not measure: ${first(e)}`);
    }
    await emulator.startAgain();
  }

  // Emulator stopped.
  await enter(ctx, stack, 'emulator stopped');
  {
    const ko = await openHome(ctx, browser, proxy, stack.studio, 'ko', 'emulator stopped', messages);
    await wrapStyles(ko.page, 'ko', recheck, 'pretty', 'balance', found.wrapKorean);
    await sweep(ko.page, 'ko / emulator stopped', found.whole, found.layout, true);
    await ko.context.close();

    for (const tag of ['en', 'de']) {
      const h = await openHome(ctx, browser, proxy, stack.studio, tag, 'emulator stopped', messages);
      await wrapStyles(h.page, tag, recheck, 'auto', 'auto', found.wrapOthers);
      await h.context.close();
    }
  }

  // Engine unreachable.
  await enter(ctx, stack, 'engine unreachable');
  {
    const ko = await openHome(ctx, browser, proxy, stack.studio, 'ko', 'engine unreachable', messages);
    await sweep(ko.page, 'ko / engine unreachable', found.whole, found.layout, true);
    await ko.context.close();
  }

  await lines.line(
    '(regression) Open `/` in Korean in each of the three states of Home, at each of the widths → every Korean word of the bar and the page is whole',
    async () => expect(cap(found.whole)).toEqual([]),
  );
  await lines.line(
    'The same pages at the same widths → no page scrolls sideways, no text is drawn outside its control or panel, and no label is cut',
    async () => expect(cap(found.layout)).toEqual([]),
  );
  await lines.line(
    'Open a path that matches no screen, in Korean, at each of the widths → every Korean word is whole, and the page does not scroll sideways',
    async () => expect(cap(found.notFound)).toEqual([]),
  );
  await lines.line(
    "In Korean at 390 wide, put a Korean word wider than the page's column into the page → the word breaks inside its box and the page does not scroll sideways",
    async () => expect(found.longWord).toEqual([]),
  );
  await lines.line(
    "In Korean, open the menu → each option that names another language, and the engine's English message on Home in the emulator stopped state, has `word-break` computed to `normal`",
    async () => expect(cap(found.otherInKorean)).toEqual([]),
  );
  await lines.line(
    'In German, open the menu → the option "한국어" has `word-break` computed to `keep-all`, and the page\'s own text `normal`',
    async () => expect(cap(found.koreanInGerman)).toEqual([]),
  );
  await lines.line(
    "Open `/` in Korean in the emulator stopped state → `text-wrap-style` of the page's paragraphs computes to `pretty` and of the notice's heading to `balance`",
    async () => expect(cap(found.wrapKorean)).toEqual([]),
  );
  await lines.line(
    "Open the same page in English and in German → `text-wrap-style` of the page's paragraphs and of the notice's heading computes to `auto`",
    async () => expect(cap(found.wrapOthers)).toEqual([]),
  );
  await lines.line(
    'Open `/` in Japanese, Thai, German and English at 390 wide → `word-break` of the bar and the page computes to `normal`',
    async () => expect(cap(found.normal)).toEqual([]),
  );
  await lines.line(
    "Open `/aws` in Korean and in English → `word-break` at the AWS area's root computes to the same value in both, and no rule of the `studio` layer matches the root or an element in it",
    async () => {
      const ko = areaWordBreak.get('ko') ?? null;
      const en = areaWordBreak.get('en') ?? null;
      const problems = [...found.area];
      if (ko === null || en === null) problems.push(`word-break at the root: ko ${String(ko)}, en ${String(en)}`);
      else if (ko !== en) problems.push(`word-break at the root: ${ko} in Korean, ${en} in English`);
      expect(cap(problems)).toEqual([]);
    },
  );

  lines.end();
});

/**
 * `text-wrap-style` of the page's paragraphs in the page's language (`p` in `main` whose language is `tag`) and of
 * the heading of the notice that holds the re-check message, against what is wanted, into `into`.
 */
async function wrapStyles(
  page: Page,
  tag: string,
  recheck: CountedMessage,
  paragraphs: string,
  heading: string,
  into: string[],
): Promise<void> {
  const where = `${tag} / emulator stopped`;
  try {
    const ps = (await elementStyles(page.getByRole('main').locator('p'), 'text-wrap-style')).filter(
      (p) => p.lang.toLowerCase() === tag.toLowerCase(),
    );
    if (ps.length === 0) into.push(`${where}: the page has no paragraph in its language`);
    for (const p of ps) {
      if (p.value !== paragraphs) into.push(`${where}: paragraph "${p.text}": text-wrap-style "${p.value}"`);
    }
    const h = await noticeHeadingStyle(page, tag, recheck, 'text-wrap-style');
    if (h === null) into.push(`${where}: no notice heading around the re-check message`);
    else if (h.value !== heading) into.push(`${where}: the notice's heading "${h.text}": text-wrap-style "${h.value}"`);
  } catch (e) {
    into.push(`${where}: could not measure: ${first(e)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// studio.count-and-unit-stay-on-one-line
// ---------------------------------------------------------------------------------------------------------------

test('studio.count-and-unit-stay-on-one-line', async ({ ctx, browser, proxy }) => {
  test.setTimeout(3_600_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const messages = countedMessages(
    ctx,
    LANGUAGES.map((l) => l.tag),
  );
  const connection = messages.find((m) => m.states.length === 1 && m.states[0] === 'connected')!;
  const lines = new Lines(ctx);
  const found = {
    together: [] as string[],
    whole: [] as string[],
    layout: [] as string[],
    germanLastLine: [] as string[],
  };
  let germanMeasured = false;

  for (const state of HOME_STATES) {
    await enter(ctx, stack, state);
    const shown = messages.filter((m) => m.states.includes(state));
    for (const l of LANGUAGES) {
      let home;
      try {
        home = await openHome(ctx, browser, proxy, stack.studio, l.tag, state, messages);
      } catch (e) {
        found.together.push(`${l.tag} / ${state}: could not open: ${first(e)}`);
        continue;
      }
      for (const width of WRAP_WIDTHS) {
        const where = `${l.tag} / ${state} ${String(width)}`;
        try {
          await resizeTo(home.page, width);
          for (const m of await measureCounted(home.page, l.tag, shown)) {
            if (m.places.length === 0) {
              found.together.push(`${where}: ${m.name} is not on the page`);
              if (l.tag !== 'ja') found.whole.push(`${where}: ${m.name} is not on the page`);
            }
            for (const p of m.places) {
              const drawn = JSON.stringify(p.drawn);
              if (p.apart) found.together.push(`${where}: the count and its unit are on two lines: ${drawn}`);
              if (l.tag !== 'ja' && p.unitBroken) {
                found.whole.push(`${where}: the count and its unit are not on one line: ${drawn}`);
              }
              if (l.tag === 'de' && state === 'connected' && width === 390 && m.name === connection.name) {
                germanMeasured = true;
                if (p.lastLineAfterCount) {
                  found.germanLastLine.push(`the last line starts after the count: ${drawn}`);
                }
              }
            }
          }
          const lay = await layout(home.page);
          if (lay.pageScrolls) found.layout.push(`${where}: the page scrolls sideways`);
          for (const i of drawnOutside(lay.issues)) found.layout.push(`${where}: ${i}`);
        } catch (e) {
          found.together.push(`${where}: could not measure: ${first(e)}`);
        }
      }
      await home.context.close();
    }
  }
  if (!germanMeasured) found.germanLastLine.push("the connection's description was not measured in German at 390");

  await lines.line(
    "(regression) Open `/` in each of the twelve languages in each of the three states of Home, at each of the widths → in each counted message shown, the count and the first character after it (the unit's, past the space where there is one) are on one line",
    async () => expect(cap(found.together, 80)).toEqual([]),
  );
  await lines.line(
    'The same, in every language but Japanese → the count and everything after it up to the next white space are on one line: the unit is whole, not hyphenated',
    async () => expect(cap(found.whole, 80)).toEqual([]),
  );
  await lines.line(
    'The same pages at the same widths → no page scrolls sideways and no text is drawn outside its control or panel',
    async () => expect(cap(found.layout, 80)).toEqual([]),
  );
  await lines.line(
    "Open `/` connected in German at 390 wide → the last line of the connection's description holds more than the unit: it starts at the count or before it",
    async () => expect(found.germanLastLine).toEqual([]),
  );

  lines.end();
});
