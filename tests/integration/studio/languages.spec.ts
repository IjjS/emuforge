// The flow checks of issue 17 (test-criteria.md, issue 17, Flow; requirement R1-R8): Studio's own layer in each of the
// twelve languages, read from the built app served by `bun run serve`, in front of a real engine started for that
// Studio and a real emulator (or an emulator port nothing listens on, for Home's "No emulator is running" notice).
// Every text is matched against the catalogue files of the checkout under test, read at run time, by value; no check
// names a message key. A language is set with the browser context's `locale` or a stored choice in its storage state,
// never with a change of Studio's code (R8.4). Words: `support/languages.ts`.
//
// `studio.language-follows-the-browser`, `studio.language-choice-applies-at-once-and-survives-reload`,
// `studio.language-first-render-is-already-in-the-language`, `studio.studio-layer-complete-in-every-language`,
// `studio.aws-area-stays-english-in-every-language`, `studio.language-layout-in-every-language`,
// `studio.language-faces-per-script`, `studio.language-control-keyboard-and-contrast`.

import createWrapper from "@cloudscape-design/components/test-utils/selectors";
import type { BrowserContext, Page, Request } from "@playwright/test";

import {
  Engine,
  expect,
  freePortExcept,
  startStack,
  test,
  waitFor,
  type Ctx,
  type Stack,
} from "./support";
import {
  ACTION,
  addressOf,
  cloudscapeElements,
  frame,
  NAVIGATION_TOGGLE,
  providersSection,
} from "./support/frame";
import { layoutIssues, markPage, stillSamePage } from "./support/home";
import { textContrast, type Focused } from "./support/layers";
import {
  allowedFaces,
  appendValues,
  areaRootLang,
  areaRootMarked,
  areaText,
  choose,
  englishOnly,
  englishTexts,
  engineWords,
  faceItems,
  faceProblem,
  FACES,
  isLang,
  language,
  languageContext,
  languageControl,
  languageMenu,
  languageProblems,
  LANGUAGES,
  liveRegions,
  markAreaRoot,
  markRecording,
  marks,
  MENU_ORDER,
  menuOptions,
  menuPlace,
  negativeTracking,
  norm,
  notOnTop,
  openMenu,
  pageText,
  placed,
  readCatalogue,
  recordRoot,
  recording,
  removeValues,
  settled,
  storedChoice,
  textProblem,
  textWithin,
  translationOf,
  ValueMatcher,
  visibleText,
  layout,
  type Catalogue,
  type FaceItem,
  type PageKind,
  type RecordedState,
} from "./support/languages";
import { Lines } from "./support/lines";
import { HEALTH_PATH, Traffic } from "./support/traffic";

/** How long Studio may take to show a page's text once the page is there. */
const SETTLE_MS = 5_000;
/** "At once" (R2.6): the text is in the new language within a second of the choice, with nothing in between. */
const AT_ONCE_MS = 1_000;
/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** Today's English wording of the build-once toggle and of the notice's heading (R4.2). */
const BUILD_ONCE =
  "First run? Build the image once, from the root of your EmuForge checkout";
const NO_EMULATOR = (port: number) =>
  `No emulator is running on port ${String(port)}`;

/** An over-long path for Studio's "Page not found" (R4.9). */
const LONG_PATH = `/does-not-exist/${"a-very-long-path-segment-without-any-break-".repeat(4)}end`;

const STUDIO_PAGES = ["/", "/does-not-exist", "/aws/s3"] as const;

// ---------------------------------------------------------------------------------------------------------------
// Shared steps.
// ---------------------------------------------------------------------------------------------------------------

/** Every catalogue of R1.1, read once. */
function catalogues(ctx: Ctx): Map<string, Catalogue> {
  const out = new Map<string, Catalogue>();
  for (const l of LANGUAGES) {
    const c = readCatalogue(ctx, l.tag);
    ctx.log(
      `catalogue ${l.tag}: ${c.missing ?? `${String(c.messages.size)} messages, ${String(c.values.length)} values`}`,
    );
    out.set(l.tag, c);
  }
  return out;
}

/** At most `n` lines of a list, with how many more there are. */
function cap(list: string[], n = 25): string[] {
  return list.length > n
    ? [...list.slice(0, n), `… and ${String(list.length - n)} more`]
    : list;
}

function kindOf(path: string): PageKind {
  if (path === "/") return "home";
  return path.startsWith("/aws") ? "area" : "not-found";
}

/** Waits for a health answer received after the `since`-th one whose emulator is (or is not) reachable. */
async function waitHealth(
  traffic: Traffic,
  reachable: boolean,
  since: number,
): Promise<void> {
  const seen = await waitFor(CHANGE_BOUND_MS, async () => {
    await traffic.settle();
    return traffic.health
      .slice(since)
      .some(
        (a) =>
          (a.body as { emulator?: { reachable?: unknown } } | null)?.emulator
            ?.reachable === reachable,
      )
      ? true
      : undefined;
  });
  if (!seen)
    throw new Error(
      `no health answer with the emulator reachable=${String(reachable)} within 10s`,
    );
}

/**
 * Opens `path` and waits for what it shows: on `/` a health answer (emulator reachable as `reachable`), on a page of
 * the AWS area its root, elsewhere an `h1`. Returns the page's kind.
 */
async function visit(
  page: Page,
  traffic: Traffic,
  path: string,
  reachable = true,
): Promise<PageKind> {
  const since = traffic.health.length;
  await page.goto(path);
  const kind = kindOf(path);
  if (kind === "home") await waitHealth(traffic, reachable, since);
  else if (kind === "area") {
    const area = await waitFor(CHANGE_BOUND_MS, async () =>
      (await areaRootLang(page)) !== null ? true : undefined,
    );
    if (!area) throw new Error(`${path}: no AWS area on the page within 10s`);
  } else
    await page
      .locator("h1")
      .first()
      .waitFor({ state: "visible", timeout: ACTION.timeout });
  return kind;
}

/** Studio's text problems once they are gone, or the last ones after `bound`. */
async function settledProblems(
  page: Page,
  catalogue: Catalogue,
  traffic: Traffic | null,
  kind: PageKind | null,
  bound = SETTLE_MS,
): Promise<string[]> {
  let last: string[] = [];
  await waitFor(bound, async () => {
    last = languageProblems(
      await pageText(page),
      catalogue,
      traffic ? engineWords(traffic) : new Set<string>(),
      kind,
    );
    return last.length === 0 ? true : undefined;
  });
  return last;
}

async function expectInLanguage(
  page: Page,
  catalogue: Catalogue,
  traffic: Traffic | null,
  kind: PageKind | null,
  where: string,
  bound = SETTLE_MS,
): Promise<void> {
  const problems = await settledProblems(page, catalogue, traffic, kind, bound);
  expect(cap(problems), `${where}: Studio's text in ${catalogue.tag}`).toEqual(
    [],
  );
}

/** A context and page with the stored choice `tag`, with its traffic recorded. */
async function storedPage(
  ctx: Ctx,
  browser: Parameters<typeof languageContext>[1],
  proxy: Parameters<typeof languageContext>[2],
  stack: { studio: Stack["studio"] },
  tag: string,
  width = 1280,
): Promise<{ context: BrowserContext; page: Page; traffic: Traffic }> {
  const { context, page } = await languageContext(
    ctx,
    browser,
    proxy,
    stack.studio,
    { stored: tag, width },
  );
  return { context, page, traffic: Traffic.attach(ctx, context, page) };
}

/** Starts the engine again, on the same port, for an emulator port nothing listens on; returns that port. */
async function engineWithoutEmulator(ctx: Ctx, stack: Stack): Promise<number> {
  const dead = await freePortExcept(ctx.home, [
    ctx.emulatorPort,
    ctx.enginePort,
    ctx.studioPort,
    stack.emulatorPort,
  ]);
  await stack.engine.stop();
  await Engine.start(ctx, { emulatorPort: dead });
  ctx.log(
    `engine started again for emulator port ${String(dead)}, where nothing listens`,
  );
  return dead;
}

/** Whether the element `locator` finds is the focused one. */
async function focusedIs(
  page: Page,
  locator: ReturnType<Page["locator"]>,
): Promise<boolean> {
  return locator
    .evaluate((el) => el === document.activeElement, undefined, ACTION)
    .catch(() => false);
}

/** Opens the build-once disclosure of Home's notice in the page's language; throws when its toggle is not there. */
async function openBuildOnce(
  page: Page,
  en: Catalogue,
  catalogue: Catalogue,
): Promise<void> {
  const label = new ValueMatcher(translationOf(en, catalogue, BUILD_ONCE));
  const toggles = page
    .getByRole("main")
    .locator("button[aria-expanded], summary");
  const texts = (await toggles.allInnerTexts()).map(norm);
  const at = texts.findIndex((t) => label.matches(t));
  if (at < 0)
    throw new Error(
      `no build-once toggle in ${catalogue.tag} among ${JSON.stringify(texts)}`,
    );
  const toggle = toggles.nth(at);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click(ACTION);
}

// ---------------------------------------------------------------------------------------------------------------
// studio.language-follows-the-browser
// ---------------------------------------------------------------------------------------------------------------

test("studio.language-follows-the-browser", async ({ ctx, browser, proxy }) => {
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const lines = new Lines(ctx);

  await lines.line(
    'Browser locale `de-DE`, nothing stored, open `/` → `<html lang="de">`, the control shows "Deutsch", and Studio\'s text comes from the German catalogue or is kept as it is',
    async () => {
      const { context, page } = await languageContext(
        ctx,
        browser,
        proxy,
        stack.studio,
        { locale: "de-DE" },
      );
      const traffic = Traffic.attach(ctx, context, page);
      await visit(page, traffic, "/");
      await expectInLanguage(
        page,
        cats.get("de")!,
        traffic,
        "home",
        "/ with the browser in de-DE",
      );
      expect(
        await visibleText(page, languageControl(page)),
        "what the control shows",
      ).toBe("Deutsch");
    },
  );

  await lines.line(
    'Browser locale `pt-PT` → Portuguese (`<html lang="pt-BR">`); `zh-CN` → English (`<html lang="en">`)',
    async () => {
      const found: Record<string, string | null> = {};
      for (const locale of ["pt-PT", "zh-CN"]) {
        const { page } = await languageContext(
          ctx,
          browser,
          proxy,
          stack.studio,
          { locale },
        );
        await page.goto("/");
        await page
          .locator("#root > *")
          .first()
          .waitFor({ state: "attached", timeout: ACTION.timeout });
        await page
          .locator("h1")
          .first()
          .waitFor({ state: "visible", timeout: ACTION.timeout });
        found[locale] = await page.locator("html").getAttribute("lang");
      }
      expect(found, "<html lang> by browser locale").toEqual({
        "pt-PT": "pt-BR",
        "zh-CN": "en",
      });
    },
  );

  await lines.line(
    'Browser locale `ko-KR`, deep link to `/does-not-exist` → Studio\'s "Page not found" in Korean; the URL has no language in it',
    async () => {
      const { context, page } = await languageContext(
        ctx,
        browser,
        proxy,
        stack.studio,
        { locale: "ko-KR" },
      );
      const traffic = Traffic.attach(ctx, context, page);
      await visit(page, traffic, "/does-not-exist");
      expect(
        await cloudscapeElements(page),
        "no provider area on the page",
      ).toEqual([]);
      await expectInLanguage(
        page,
        cats.get("ko")!,
        traffic,
        "not-found",
        "/does-not-exist with the browser in ko-KR",
      );
      const url = new URL(page.url());
      expect(
        { path: url.pathname, search: url.search, hash: url.hash },
        "the address",
      ).toEqual({
        path: "/does-not-exist",
        search: "",
        hash: "",
      });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-choice-applies-at-once-and-survives-reload
// ---------------------------------------------------------------------------------------------------------------

test("studio.language-choice-applies-at-once-and-survives-reload", async ({
  ctx,
  page,
  context,
  browser,
  proxy,
}) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const de = cats.get("de")!;
  const en = cats.get("en")!;
  const lines = new Lines(ctx);
  const traffic = Traffic.attach(ctx, context, page);
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });

  await lines.line(
    "English browser, on `/` scrolled to the providers section, choose Deutsch → Studio's text is German at once, with no navigation or reload, no request to the engine, the same path and scroll position, and focus on the control",
    async () => {
      await visit(page, traffic, "/");
      await providersSection(page).scrollIntoViewIfNeeded(ACTION);
      // Right after an answer the next timed check is 5 seconds away: a request in the next seconds is the choice's.
      await page.waitForResponse(
        (r) => new URL(r.url()).pathname === HEALTH_PATH,
        { timeout: CHANGE_BOUND_MS },
      );
      await markPage(page);
      const before = {
        url: page.url(),
        scrollY: await page.evaluate(() => scrollY),
        navigations,
      };
      const from = Date.now();
      await choose(page, "Deutsch");
      const problems = await settledProblems(
        page,
        de,
        traffic,
        "home",
        AT_ONCE_MS,
      );
      await traffic.settle();
      const engineRequests = traffic.requests
        .filter(
          (r) => r.at >= from && new URL(r.url).origin === stack.engine.url,
        )
        .map((r) => `${r.method} ${new URL(r.url).pathname}`);
      expect(
        {
          problems: cap(problems),
          samePage: await stillSamePage(page),
          navigations: navigations - before.navigations,
          url: page.url(),
          scrollY: Math.round(await page.evaluate(() => scrollY)),
          focusOnControl: await focusedIs(page, languageControl(page)),
          engineRequests,
        },
        "after choosing Deutsch",
      ).toEqual({
        problems: [],
        samePage: true,
        navigations: 0,
        url: before.url,
        scrollY: Math.round(before.scrollY),
        focusOnControl: true,
        engineRequests: [],
      });
    },
  );

  await lines.line(
    "Reload → German; a second tab in the same browser → German; the stored choice is `de`",
    async () => {
      await page.reload();
      await visit(page, traffic, "/");
      await expectInLanguage(page, de, traffic, "home", "/ reloaded");
      const second = await context.newPage();
      const secondTraffic = Traffic.attach(ctx, context, second);
      await visit(second, secondTraffic, "/");
      await expectInLanguage(
        second,
        de,
        secondTraffic,
        "home",
        "/ in a second tab",
      );
      expect(await storedChoice(page), "the stored choice").toBe("de");
      await second.close();
    },
  );

  await lines.line(
    "Back and forward between `/` and `/does-not-exist` after the change → German on both",
    async () => {
      await visit(page, traffic, "/");
      await visit(page, traffic, "/does-not-exist");
      await page.goBack();
      await expect(page).toHaveURL(addressOf("/"));
      await expectInLanguage(page, de, traffic, "home", "/ after back");
      await page.goForward();
      await expect(page).toHaveURL(addressOf("/does-not-exist"));
      await expectInLanguage(
        page,
        de,
        traffic,
        "not-found",
        "/does-not-exist after forward",
      );
    },
  );

  await lines.line(
    "A tab open before the choice was made in another tab → keeps its language until reloaded, then German (R2.5)",
    async () => {
      const fresh = await languageContext(ctx, browser, proxy, stack.studio);
      const earlyTraffic = Traffic.attach(ctx, fresh.context, fresh.page);
      await visit(fresh.page, earlyTraffic, "/");
      await expectInLanguage(
        fresh.page,
        en,
        earlyTraffic,
        "home",
        "the early tab before the choice",
      );
      const other = await fresh.context.newPage();
      await visit(other, Traffic.attach(ctx, fresh.context, other), "/");
      await choose(other, "Deutsch");
      await expectInLanguage(
        other,
        de,
        null,
        "home",
        "the tab where Deutsch was chosen",
      );
      await expectInLanguage(
        fresh.page,
        en,
        earlyTraffic,
        "home",
        "the early tab after the choice elsewhere",
      );
      await fresh.page.reload();
      await visit(fresh.page, earlyTraffic, "/");
      await expectInLanguage(
        fresh.page,
        de,
        earlyTraffic,
        "home",
        "the early tab reloaded",
      );
    },
  );

  await lines.line(
    'Choose "Browser language" → English at once, the key is gone; reload → English',
    async () => {
      const s = await storedPage(ctx, browser, proxy, stack, "de");
      await visit(s.page, s.traffic, "/");
      await choose(s.page, "browser");
      await expectInLanguage(
        s.page,
        en,
        s.traffic,
        "home",
        'after "Browser language"',
        AT_ONCE_MS,
      );
      expect(await storedChoice(s.page), "the stored choice").toBeNull();
      await s.page.reload();
      await visit(s.page, s.traffic, "/");
      await expectInLanguage(
        s.page,
        en,
        s.traffic,
        "home",
        'reloaded after "Browser language"',
      );
    },
  );

  await lines.line(
    "Choose Deutsch, then at once Français → French, and the stored choice is `fr`",
    async () => {
      const s = await languageContext(ctx, browser, proxy, stack.studio);
      const t = Traffic.attach(ctx, s.context, s.page);
      await visit(s.page, t, "/");
      await choose(s.page, "Deutsch");
      await choose(s.page, "Français");
      await expectInLanguage(
        s.page,
        cats.get("fr")!,
        t,
        "home",
        "after Deutsch then Français",
      );
      expect(await storedChoice(s.page), "the stored choice").toBe("fr");
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-first-render-is-already-in-the-language
// ---------------------------------------------------------------------------------------------------------------

/** Problems of one recorded state of `#root` in the language of `catalogue`. */
function stateProblems(state: RecordedState, catalogue: Catalogue): string[] {
  return languageProblems(
    { items: state.items, title: "", htmlLang: state.lang, dirs: [] },
    catalogue,
    new Set(),
    null,
  );
}

test("studio.language-first-render-is-already-in-the-language", async ({
  ctx,
  page,
  browser,
  proxy,
}) => {
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const th = cats.get("th")!;
  const lines = new Lines(ctx);

  await lines.line(
    "Stored `th`, load `/` with a recorder of every change to `#root` from the document's start → the first recorded content is Thai with `<html lang=\"th\">`; no recorded state holds a text of the English catalogue that differs from Thai's",
    async () => {
      const s = await languageContext(ctx, browser, proxy, stack.studio, {
        stored: "th",
        record: true,
      });
      const t = Traffic.attach(ctx, s.context, s.page);
      await visit(s.page, t, "/");
      await settledProblems(s.page, th, t, "home");
      const rec = await recording(s.page);
      ctx.log(
        `recorded ${String(rec.states.length)} states of #root; <html lang> at the first content: ${String(rec.firstContentLang)}`,
      );
      const first = rec.states[0];
      const thMatcher = new ValueMatcher(th.values);
      const english = englishOnly(cats.get("en")!, th);
      const englishSeen = rec.states.flatMap((s2, i) =>
        englishTexts(s2.items, english, thMatcher).map(
          (e) => `state ${String(i)}: ${e}`,
        ),
      );
      expect(
        {
          firstContentLang: rec.firstContentLang,
          firstState: first
            ? cap(stateProblems(first, th))
            : ["nothing was recorded in #root"],
          englishSeen: cap(englishSeen),
        },
        "the recording of #root",
      ).toEqual({ firstContentLang: "th", firstState: [], englishSeen: [] });
    },
  );

  await lines.line(
    "Choose Deutsch on `/` with the recorder on → the first change recorded after the choice already shows Studio's text wholly German",
    async () => {
      await recordRoot(page);
      const traffic = Traffic.attach(ctx, page.context(), page);
      await visit(page, traffic, "/");
      await openMenu(page);
      await markRecording(page);
      await menuOptions(page)
        .filter({ hasText: /^Deutsch$/ })
        .click(ACTION);
      const after = await waitFor(2_000, async () => {
        const rec = await recording(page);
        return rec.mark !== null && rec.states.length > rec.mark
          ? rec.states[rec.mark]
          : undefined;
      });
      expect(
        after,
        "a change of #root recorded after the choice",
      ).toBeDefined();
      expect(
        cap(stateProblems(after!, cats.get("de")!)),
        "the first state after the choice",
      ).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.studio-layer-complete-in-every-language
// ---------------------------------------------------------------------------------------------------------------

test("studio.studio-layer-complete-in-every-language", async ({
  ctx,
  browser,
  proxy,
}) => {
  test.setTimeout(900_000);
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const en = cats.get("en")!;
  const lines = new Lines(ctx);

  await lines.line(
    "For each of the twelve languages (stored choice), on `/` connected, on `/does-not-exist`, and the frame on `/aws/s3` → `<html lang>` is the language's tag, `dir` is unset or `ltr`, the document title is as R5.2, and every text of Studio's text comes from that language's catalogue or is kept as it is",
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const s = await storedPage(ctx, browser, proxy, stack, l.tag);
        for (const path of STUDIO_PAGES) {
          const kind = await visit(s.page, s.traffic, path);
          for (const p of await settledProblems(
            s.page,
            cats.get(l.tag)!,
            s.traffic,
            kind,
          ))
            found.push(`${l.tag} ${path}: ${p}`);
        }
        await s.context.close();
      }
      expect(cap(found, 60)).toEqual([]);
    },
  );

  await lines.line(
    'For each language, the menu open → the twelve own names and "Browser language" in that language',
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const s = await storedPage(ctx, browser, proxy, stack, l.tag);
        try {
          await visit(s.page, s.traffic, "/");
          await openMenu(s.page);
          const options = (await menuOptions(s.page).allInnerTexts()).map(norm);
          const names = options.slice(1).sort();
          if (
            JSON.stringify(names) !== JSON.stringify([...MENU_ORDER].sort())
          ) {
            found.push(
              `${l.tag}: the options after the first are ${JSON.stringify(options.slice(1))}`,
            );
          }
          const matcher = new ValueMatcher(cats.get(l.tag)!.values);
          const engine = engineWords(s.traffic);
          for (const item of await textWithin(
            s.page,
            menuOptions(s.page).first(),
          )) {
            const p = textProblem(item, l.tag, matcher, engine);
            if (p) found.push(`${l.tag} "Browser language": ${p}`);
          }
          for (const p of await settledProblems(
            s.page,
            cats.get(l.tag)!,
            s.traffic,
            "home",
          ))
            found.push(`${l.tag} menu open: ${p}`);
        } catch (e) {
          found.push(`${l.tag}: ${(e as Error).message.split("\n")[0]}`);
        }
        await s.context.close();
      }
      expect(cap(found, 60)).toEqual([]);
    },
  );

  await lines.line(
    "For each language, on each of those pages → exactly one `main`, and the banner outside it (R6.5)",
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const s = await storedPage(ctx, browser, proxy, stack, l.tag);
        for (const path of STUDIO_PAGES) {
          await visit(s.page, s.traffic, path);
          const mains = await s.page.getByRole("main").count();
          const banners = await frame(s.page).banner.count();
          const bannerInMain =
            banners === 1
              ? await frame(s.page).banner.evaluate(
                  (b) => b.closest('main, [role="main"]') !== null,
                )
              : null;
          if (mains !== 1)
            found.push(`${l.tag} ${path}: ${String(mains)} main landmarks`);
          if (banners !== 1)
            found.push(`${l.tag} ${path}: ${String(banners)} Studio banners`);
          if (bannerInMain)
            found.push(`${l.tag} ${path}: the banner is inside main`);
        }
        await s.context.close();
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'In German, move from `/` to `/aws/s3` within the built app (the area loaded on that move) → #19\'s route announcement comes from the German catalogue, and the area page title in it is in an element with `lang="en"` (binds once #19 is merged)',
    async () => {
      const s = await storedPage(ctx, browser, proxy, stack, "de");
      await visit(s.page, s.traffic, "/");
      await s.page
        .getByRole("main")
        .locator('a[href="/aws/s3"]')
        .first()
        .click(ACTION);
      await expect(s.page).toHaveURL(addressOf("/aws/s3"));
      const title = "Amazon Simple Storage Service";
      const region = await waitFor(CHANGE_BOUND_MS, async () =>
        (await liveRegions(s.page)).find((r) => r.text.includes(title)),
      );
      expect(
        region,
        `a live region of Studio's own layer announcing "${title}"`,
      ).toBeDefined();
      const matcher = new ValueMatcher(cats.get("de")!.values);
      const problems = region!.items
        .map((i) => textProblem(i, "de", matcher, new Set()))
        .filter((p): p is string => p !== null);
      const titled = region!.items.filter((i) => norm(i.text) === title);
      expect(
        {
          problems,
          titleInLangEn:
            titled.length > 0 &&
            titled.every((i) => i.explicit && isLang(i.lang, "en")),
          wholeFromCatalogue: matcher.matches(region!.text),
        },
        `the announcement "${region!.text}"`,
      ).toEqual({
        problems: [],
        titleInLangEn: true,
        wholeFromCatalogue: true,
      });
      await s.context.close();
    },
  );

  // Last: it starts the engine again for an emulator port nothing listens on.
  await lines.line(
    'For each language, with the engine started for an emulator port nothing listens on → Home\'s "No emulator is running" notice and its steps in that language, the port unformatted',
    async () => {
      const port = await engineWithoutEmulator(ctx, stack);
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const cat = cats.get(l.tag)!;
        const s = await storedPage(ctx, browser, proxy, stack, l.tag);
        try {
          await visit(s.page, s.traffic, "/", false);
          for (const p of await settledProblems(s.page, cat, s.traffic, "home"))
            found.push(`${l.tag}: ${p}`);
          const heading = new ValueMatcher(
            translationOf(en, cat, NO_EMULATOR(port)),
          );
          const headings = (
            await s.page.getByRole("main").getByRole("heading").allInnerTexts()
          ).map(norm);
          const notice = headings.find((h) => heading.matches(h));
          if (!notice)
            found.push(
              `${l.tag}: no heading of the notice among ${JSON.stringify(headings)}`,
            );
          else if (!new RegExp(`(^|\\D)${String(port)}(\\D|$)`).test(notice)) {
            found.push(
              `${l.tag}: the notice's heading "${notice}" does not read the port ${String(port)}`,
            );
          }
          const main = await s.page.getByRole("main").innerText();
          const grouped = new Intl.NumberFormat(l.tag).format(port);
          if (grouped !== String(port) && main.includes(grouped))
            found.push(`${l.tag}: the port is formatted as "${grouped}"`);
        } catch (e) {
          found.push(`${l.tag}: ${(e as Error).message.split("\n")[0]}`);
        }
        await s.context.close();
      }
      expect(cap(found, 60)).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.aws-area-stays-english-in-every-language
// ---------------------------------------------------------------------------------------------------------------

const AREA_PAGES = ["/aws", "/aws/s3", "/aws/does-not-exist"] as const;
const NAVIGATION_CLOSE = createWrapper()
  .findAppLayout()
  .findNavigationClose()
  .toSelector();

/** The area's text once it has stopped changing (two equal reads), or `null` without an area. */
async function stableAreaText(page: Page): Promise<string[] | null> {
  let last: string[] | null = null;
  const stable = await waitFor(SETTLE_MS, async () => {
    await settled(page);
    const now = await areaText(page);
    const same =
      now !== null &&
      last !== null &&
      JSON.stringify(now) === JSON.stringify(last);
    last = now;
    return same ? now : undefined;
  });
  return stable ?? last;
}

/** The first entries where two lists of area text differ. */
function differences(a: string[] | null, b: string[] | null): string[] {
  if (a === null || b === null)
    return [
      `area text: ${a === null ? "none" : "present"} vs ${b === null ? "none" : "present"}`,
    ];
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < 5; i++) {
    if (a[i] !== b[i])
      out.push(
        `#${String(i)}: "${a[i] ?? "(none)"}" instead of "${b[i] ?? "(none)"}"`,
      );
  }
  return out;
}

test("studio.aws-area-stays-english-in-every-language", async ({
  ctx,
  page,
  browser,
  proxy,
}) => {
  test.setTimeout(600_000);
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const lines = new Lines(ctx);
  const traffic = Traffic.attach(ctx, page.context(), page);

  await lines.line(
    "For each of the twelve languages, `/aws`, `/aws/s3` and `/aws/does-not-exist` → the area's text and accessible names equal those of the English run, and the area's root carries `lang=\"en\"`",
    async () => {
      const english = new Map<string, string[] | null>();
      for (const path of AREA_PAGES) {
        await visit(page, traffic, path);
        english.set(path, await stableAreaText(page));
      }
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const s = await storedPage(ctx, browser, proxy, stack, l.tag);
        for (const path of AREA_PAGES) {
          await visit(s.page, s.traffic, path);
          const text = await stableAreaText(s.page);
          for (const d of differences(text, english.get(path)!))
            found.push(`${l.tag} ${path}: ${d}`);
          const lang = await areaRootLang(s.page);
          if (lang === null || !isLang(lang, "en"))
            found.push(
              `${l.tag} ${path}: the area's root has lang="${String(lang)}"`,
            );
        }
        await s.context.close();
      }
      expect(cap(found, 60)).toEqual([]);
    },
  );

  await lines.line(
    "On `/aws/s3` with the side navigation's state set, choose Deutsch → the frame is German; the area's root is the same element as before, its text and state unchanged",
    async () => {
      const s = await languageContext(ctx, browser, proxy, stack.studio);
      const t = Traffic.attach(ctx, s.context, s.page);
      await visit(s.page, t, "/aws/s3");
      await s.page.locator(NAVIGATION_CLOSE).click(ACTION);
      await expect(
        s.page.locator(NAVIGATION_TOGGLE),
        "the side navigation closed",
      ).toBeVisible();
      const before = await stableAreaText(s.page);
      expect(await markAreaRoot(s.page), "the area has a root").toBe(true);
      await choose(s.page, "Deutsch");
      const problems = await settledProblems(
        s.page,
        cats.get("de")!,
        t,
        "area",
      );
      expect(
        {
          problems: cap(problems),
          sameRoot: await areaRootMarked(s.page),
          areaText: differences(await stableAreaText(s.page), before),
          navigationStillClosed: await s.page
            .locator(NAVIGATION_TOGGLE)
            .isVisible(),
        },
        "after choosing Deutsch on /aws/s3",
      ).toEqual({
        problems: [],
        sameRoot: true,
        areaText: [],
        navigationStillClosed: true,
      });
    },
  );

  await lines.line(
    "On `/aws/s3` at 1280 and 390, open the menu → the topmost element at the menu's corners and centre is the menu's; close it → the area as before",
    async () => {
      const found: string[] = [];
      for (const width of [1280, 390]) {
        const s = await languageContext(ctx, browser, proxy, stack.studio, {
          width,
        });
        const t = Traffic.attach(ctx, s.context, s.page);
        await visit(s.page, t, "/aws/s3");
        const before = await stableAreaText(s.page);
        await markAreaRoot(s.page);
        await openMenu(s.page);
        for (const p of await notOnTop(s.page, languageMenu(s.page)))
          found.push(`${String(width)}: not on top at ${p}`);
        await s.page.keyboard.press("Escape");
        await expect(languageMenu(s.page), "the menu closed").toBeHidden();
        for (const d of differences(await stableAreaText(s.page), before))
          found.push(`${String(width)}: after closing, ${d}`);
        if (!(await areaRootMarked(s.page)))
          found.push(
            `${String(width)}: the area's root is another element after closing`,
          );
        await s.context.close();
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-layout-in-every-language
// ---------------------------------------------------------------------------------------------------------------

interface LayoutFindings {
  layout: string[];
  bar: string[];
  tracking: string[];
  menu: string[];
  commands: string[];
}

/** The wordmark, every navigation link and the control: inside the viewport and not covered. */
async function barProblems(page: Page, where: string): Promise<string[]> {
  const f = frame(page);
  const out: string[] = [];
  const items = [
    { name: "the wordmark", locator: f.wordmark },
    ...Array.from(
      {
        length: await f.banner
          .getByRole("navigation")
          .getByRole("link")
          .count(),
      },
      (_, i) => ({
        name: `navigation link ${String(i + 1)}`,
        locator: f.banner.getByRole("navigation").getByRole("link").nth(i),
      }),
    ),
    { name: "the control", locator: languageControl(page) },
  ];
  for (const item of items) {
    try {
      const p = await placed(page, item.locator);
      if (!p.inside)
        out.push(
          `${where}: ${item.name} (${p.rect}) is not inside the viewport`,
        );
      if (p.covered) out.push(`${where}: ${item.name} (${p.rect}) is covered`);
    } catch (e) {
      out.push(
        `${where}: ${item.name}: ${(e as Error).message.split("\n")[0]}`,
      );
    }
  }
  return out;
}

/** What the control shows: the globe alone (`''`) or the own name. */
async function controlShows(page: Page): Promise<string | null> {
  return visibleText(page, languageControl(page)).catch(() => null);
}

test("studio.language-layout-in-every-language", async ({
  ctx,
  browser,
  proxy,
}) => {
  test.setTimeout(1_800_000);
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const en = cats.get("en")!;
  const lines = new Lines(ctx);
  const found: LayoutFindings = {
    layout: [],
    bar: [],
    tracking: [],
    menu: [],
    commands: [],
  };

  /** Measures the page as it is drawn now, in `tag`, into `found`. */
  const measure = async (
    page: Page,
    tag: string,
    where: string,
    width: number,
    withMenu: boolean,
  ) => {
    const l = await layout(page);
    if (l.pageScrolls) found.layout.push(`${where}: the page scrolls sideways`);
    for (const i of l.issues) found.layout.push(`${where}: ${i}`);
    if (width === 390) found.bar.push(...(await barProblems(page, where)));
    const shows = await controlShows(page);
    const own = language(tag).name;
    if (width === 390 && shows !== "")
      found.bar.push(
        `${where}: the control shows "${String(shows)}", not the globe alone`,
      );
    if (width === 1280 && shows !== own)
      found.bar.push(
        `${where}: the control shows "${String(shows)}", not "${own}"`,
      );
    if (tag in { th: 1, ko: 1, ja: 1 } && (width === 1280 || width === 390)) {
      for (const t of await negativeTracking(page, tag))
        found.tracking.push(`${where}: ${t}`);
    }
    if (withMenu) {
      try {
        await openMenu(page);
        const m = await menuPlace(page);
        for (const p of m.problems) found.menu.push(`${where}: ${p}`);
        if (width === 390)
          for (const c of m.covers)
            found.menu.push(`${where}: the menu covers ${c}`);
        await page.keyboard.press("Escape");
      } catch (e) {
        found.menu.push(`${where}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  };

  const sweep = async (paths: string[], reachable: boolean) => {
    for (const l of LANGUAGES) {
      const s = await storedPage(ctx, browser, proxy, stack, l.tag);
      for (const width of [1280, 390]) {
        await s.page.setViewportSize({
          width,
          height: width === 390 ? 844 : 800,
        });
        for (const scheme of ["light", "dark"] as const) {
          await s.page.emulateMedia({ colorScheme: scheme });
          for (const path of paths) {
            const where = `${l.tag} ${path === LONG_PATH ? "/does-not-exist/<long>" : path}${reachable ? "" : " (no emulator, build-once open)"} ${String(width)} ${scheme}`;
            try {
              await visit(s.page, s.traffic, path, reachable);
              if (!reachable) {
                try {
                  await openBuildOnce(s.page, en, cats.get(l.tag)!);
                } catch (e) {
                  found.layout.push(
                    `${where}: ${(e as Error).message.split("\n")[0]}`,
                  );
                }
                const pres = (await s.page.locator("pre").allTextContents())
                  .flatMap((t) => t.split("\n"))
                  .map((t) => t.trim())
                  .filter((t) => t !== "");
                if (pres.length === 0)
                  found.commands.push(`${where}: no command is shown`);
                const c = await layoutIssues(s.page, pres);
                for (const w of c.wrapped)
                  found.commands.push(`${where}: command line wrapped: ${w}`);
                for (const m of c.missing)
                  found.commands.push(`${where}: command line not shown: ${m}`);
              }
              await settled(s.page);
              await measure(
                s.page,
                l.tag,
                where,
                width,
                path === "/" && reachable,
              );
            } catch (e) {
              const message = `${where}: could not measure: ${(e as Error).message.split("\n")[0]}`;
              found.layout.push(message);
            }
          }
        }
      }
      await s.context.close();
    }
  };

  await sweep(["/", LONG_PATH, "/aws/s3"], true);

  // Polish, Vietnamese and German at 480 and 481 on `/`.
  const narrow: string[] = [];
  for (const tag of ["pl", "vi", "de"]) {
    const s = await storedPage(ctx, browser, proxy, stack, tag);
    for (const width of [480, 481]) {
      const where = `${tag} / ${String(width)}`;
      try {
        await s.page.setViewportSize({ width, height: 800 });
        await visit(s.page, s.traffic, "/");
        await settled(s.page);
        const shows = await controlShows(s.page);
        const own = language(tag).name;
        if (width === 480 && shows !== "")
          narrow.push(
            `${where}: the control shows "${String(shows)}", not the globe alone`,
          );
        if (width === 481) {
          if (shows !== own)
            narrow.push(
              `${where}: the control shows "${String(shows)}", not "${own}"`,
            );
          narrow.push(...(await barProblems(s.page, where)));
          if ((await layout(s.page)).pageScrolls)
            narrow.push(`${where}: the page scrolls sideways`);
        }
      } catch (e) {
        narrow.push(`${where}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await s.context.close();
  }

  await engineWithoutEmulator(ctx, stack);
  await sweep(["/"], false);

  await lines.line(
    'For each of the twelve languages, at 1280 and 390, light and dark, on `/` connected, on `/` with the "No emulator is running" notice and build-once open, on `/does-not-exist` with an over-long path, and on `/aws/s3` → no page scrolls sideways, no element of Studio\'s own layer that holds text is wider than its box (scrollers excepted), and no button label or status word is cut',
    async () => expect(cap(found.layout, 80)).toEqual([]),
  );
  await lines.line(
    "The same runs at 390 → the wordmark, every navigation link and the control are inside the viewport and none is covered; the control shows the globe alone; at 1280 it shows the own name",
    async () => expect(cap(found.bar, 80)).toEqual([]),
  );
  await lines.line(
    "Polish, Vietnamese and German at 480 wide → the control shows the globe alone; at 481 wide → it shows the own name, and the wordmark, every navigation link and the control are inside the viewport, none covered, with no sideways scroll",
    async () => expect(narrow).toEqual([]),
  );
  await lines.line(
    "Thai, Korean and Japanese at 1280 and 390 → no text node of Studio's own layer that holds text of that script has a computed `letter-spacing` below 0 (R6.3)",
    async () => expect(cap(found.tracking, 80)).toEqual([]),
  );
  await lines.line(
    "The menu open at 1280 and 390, in each language → it lies inside the viewport, scrolls within itself when taller, and covers neither the bar's hairline nor the current tab's underline at 390",
    async () => expect(cap(found.menu, 80)).toEqual([]),
  );
  await lines.line(
    "The commands in each language → every line of every `pre` reads unbroken",
    async () => expect(cap(found.commands, 80)).toEqual([]),
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-faces-per-script
// ---------------------------------------------------------------------------------------------------------------

const POLISH_LETTERS = /[ąćęłńśźżĄĆĘŁŃŚŹŻ]/u;

test("studio.language-faces-per-script", async ({
  ctx,
  page,
  context,
  browser,
  proxy,
}) => {
  test.setTimeout(900_000);
  const stack = await startStack(ctx);
  const cats = catalogues(ctx);
  const lines = new Lines(ctx);

  // Every font the browser requests, from every context of the check.
  const fontRequests: string[] = [];
  const watchFonts = (c: BrowserContext) =>
    c.on("request", (r: Request) => {
      if (
        r.resourceType() === "font" ||
        /\.(woff2?|ttf|otf)(\?|$)/i.test(new URL(r.url()).pathname)
      )
        fontRequests.push(r.url());
    });
  watchFonts(context);
  const open = async (tag: string) => {
    const s = await storedPage(ctx, browser, proxy, stack, tag);
    watchFonts(s.context);
    return s;
  };

  const drawn: FaceItem[] = [];
  const itemsByTag = new Map<string, FaceItem[]>();
  const record = (tag: string, items: FaceItem[]) => {
    drawn.push(...items);
    itemsByTag.set(tag, [...(itemsByTag.get(tag) ?? []), ...items]);
  };

  await engineWithoutEmulator(ctx, stack);

  await lines.line(
    'For each of the twelve languages, on `/` with the "No emulator is running" notice and on `/does-not-exist` → every text node of Studio\'s own layer is drawn only by the faces of the passed mock for its language (Latin runs in Instrument Sans; Thai, Cyrillic, Korean and Japanese runs in their face; Vietnamese wholly in Noto Sans; code in JetBrains Mono), with no other face reported (no fallback, no last-resort glyph)',
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const s = await open(l.tag);
        for (const path of ["/", "/does-not-exist"]) {
          await visit(s.page, s.traffic, path, false);
          await settledProblems(
            s.page,
            cats.get(l.tag)!,
            s.traffic,
            kindOf(path),
          );
          const items = await faceItems(s.page);
          record(l.tag, items);
          ctx.log(`${l.tag} ${path}: ${String(items.length)} drawn text nodes`);
          for (const item of items) {
            const p = faceProblem(item);
            if (p) found.push(`${l.tag} ${path}: ${p}`);
          }
          if (
            !items.some(
              (i) =>
                isLang(i.lang, l.tag) &&
                !i.code &&
                !i.wordmark &&
                /\p{L}/u.test(i.text),
            )
          ) {
            found.push(`${l.tag} ${path}: no drawn text in ${l.tag}`);
          }
        }
        await s.context.close();
      }
      expect(cap(found, 80)).toEqual([]);
    },
  );

  await lines.line(
    "For each of the twelve languages, on `/` in that language, every value of its catalogue set by the check as the text of a paragraph appended to Studio's `main` (the check adds the paragraph; Studio's code is unchanged) → each is drawn only by the faces of the passed mock for that language, with no other face reported, so every character of the catalogue is covered (R6.1, R6.2)",
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const cat = cats.get(l.tag)!;
        if (cat.missing) {
          found.push(`${l.tag}: ${cat.missing}`);
          continue;
        }
        const s = await open(l.tag);
        await visit(s.page, s.traffic, "/", false);
        const values = [...new Set(cat.values.filter((v) => v.trim() !== ""))];
        await appendValues(s.page, values);
        const items = (await faceItems(s.page)).filter((i) => i.value);
        record(l.tag, items);
        if (items.length < values.length) {
          found.push(
            `${l.tag}: ${String(values.length - items.length)} of ${String(values.length)} values are not drawn`,
          );
        }
        for (const item of items) {
          const p = faceProblem(item);
          if (p) found.push(`${l.tag} value: ${p}`);
        }
        await removeValues(s.page);
        await s.context.close();
      }
      expect(cap(found, 80)).toEqual([]);
    },
  );

  await lines.line(
    'Every Polish text, with its ą ć ę ł ń ś ź ż ("Strona główna") → drawn by Instrument Sans alone',
    async () => {
      const polish = (itemsByTag.get("pl") ?? []).filter(
        (i) => POLISH_LETTERS.test(i.text) && !i.code,
      );
      const found = polish
        .map((i) => faceProblem(i, [FACES.latin]))
        .filter((p): p is string => p !== null);
      if (polish.length === 0)
        found.push("no drawn Polish text with one of ą ć ę ł ń ś ź ż");
      expect(cap(found)).toEqual([]);
    },
  );

  await lines.line(
    "The wordmark in every language → Instrument Sans alone",
    async () => {
      const found: string[] = [];
      for (const l of LANGUAGES) {
        const marksDrawn = (itemsByTag.get(l.tag) ?? []).filter(
          (i) => i.wordmark,
        );
        if (marksDrawn.length === 0)
          found.push(`${l.tag}: the wordmark was not drawn`);
        for (const i of marksDrawn) {
          const p = faceProblem(i, [FACES.latin]);
          if (p) found.push(`${l.tag}: ${p}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The menu open on an English, a German, a Japanese and a Vietnamese page → each own name is drawn by the face of its own script (ไทย in Noto Sans Thai, Русский in Noto Sans, Tiếng Việt in Noto Sans, 한국어 in Apple SD Gothic Neo, 日本語 in Hiragino Sans, Latin-script names in Instrument Sans)",
    async () => {
      const found: string[] = [];
      for (const tag of ["en", "de", "ja", "vi"]) {
        const s = await open(tag);
        try {
          await visit(s.page, s.traffic, "/", false);
          await openMenu(s.page);
          const items = await faceItems(s.page);
          for (const l of LANGUAGES) {
            const named = items.filter((i) => norm(i.text) === l.name);
            if (named.length === 0)
              found.push(`${tag} page: "${l.name}" is not drawn`);
            for (const i of named) {
              const p = faceProblem(
                i,
                allowedFaces({
                  text: i.text,
                  lang: l.tag,
                  code: false,
                  wordmark: false,
                }),
              );
              if (p) found.push(`${tag} page: ${p}`);
            }
          }
        } catch (e) {
          found.push(`${tag} page: ${(e as Error).message.split("\n")[0]}`);
        }
        await s.context.close();
      }
      expect(cap(found, 60)).toEqual([]);
    },
  );

  await lines.line(
    "No font is requested from another origin than Studio's",
    async () => {
      await page.goto("/");
      await settled(page);
      ctx.log(`fonts requested: ${String(fontRequests.length)}`);
      expect(
        fontRequests.filter((u) => new URL(u).origin !== stack.studio.origin),
      ).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-control-keyboard-and-contrast
// ---------------------------------------------------------------------------------------------------------------

/** Presses Tab, at most `bound` times, until `locator`'s element is focused. */
async function tabTo(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  bound = 40,
): Promise<boolean> {
  for (let i = 0; i < bound; i++) {
    await page.keyboard.press("Tab");
    if (await focusedIs(page, locator)) return true;
  }
  return false;
}

/** The focused element and its focus indicator, as `support/layers.ts` measures it (its probe is installed first). */
async function focusIndicator(page: Page): Promise<Focused | null> {
  await textContrast(page);
  return page.evaluate(
    () =>
      (
        window as unknown as { __emuforgeLayers: { focused(): unknown } }
      ).__emuforgeLayers.focused() as Focused | null,
  );
}

test("studio.language-control-keyboard-and-contrast", async ({ ctx, page }) => {
  test.setTimeout(300_000);
  await startStack(ctx);
  const lines = new Lines(ctx);
  const traffic = Traffic.attach(ctx, page.context(), page);
  const control = languageControl(page);

  await lines.line(
    "On `/` and `/aws/s3`, Tab from the page's start → the skip link, the wordmark, each navigation link, then the control, in visible order",
    async () => {
      const found: string[] = [];
      for (const path of ["/", "/aws/s3"]) {
        await visit(page, traffic, path);
        const f = frame(page);
        const links = f.banner.getByRole("navigation").getByRole("link");
        const expected = [
          {
            name: "the skip link",
            locator: f.banner.locator('a[href^="#"]').first(),
          },
          { name: "the wordmark", locator: f.wordmark },
          ...Array.from({ length: await links.count() }, (_, i) => ({
            name: `navigation link ${String(i + 1)}`,
            locator: links.nth(i),
          })),
          { name: "the control", locator: control },
        ];
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur?.(),
        );
        let lastLeft = -Infinity;
        for (const [i, e] of expected.entries()) {
          await page.keyboard.press("Tab");
          if (!(await focusedIs(page, e.locator))) {
            const at = await page.evaluate(() => {
              const a = document.activeElement;
              return a
                ? `${a.tagName.toLowerCase()} "${(a.textContent ?? "").trim().slice(0, 30)}"`
                : "nothing";
            });
            found.push(
              `${path}: Tab ${String(i + 1)} focuses ${at}, not ${e.name}`,
            );
            break;
          }
          if (i > 0) {
            const box = await e.locator.boundingBox();
            if (box && box.x < lastLeft)
              found.push(
                `${path}: ${e.name} is drawn before the stop that precedes it`,
              );
            if (box) lastLeft = box.x;
          }
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Enter on the control → the menu opens with focus on the checked option, visibly focused; Esc → closed, focus back on the control, nothing changed",
    async () => {
      await visit(page, traffic, "/");
      const nameBefore = await control
        .getAttribute("aria-label", ACTION)
        .catch(() => null);
      expect(await tabTo(page, control), "Tab reaches the control").toBe(true);
      await page.keyboard.press("Enter");
      await expect(languageMenu(page), "the menu").toBeVisible();
      const checked = menuOptions(page).and(
        page.locator('[aria-checked="true"]'),
      );
      const ring = await focusIndicator(page);
      expect(
        {
          focusOnChecked: await focusedIs(page, checked),
          focusVisible: await page.evaluate(
            () => document.activeElement?.matches(":focus-visible") ?? false,
          ),
          indicator: ring?.indicator ?? null,
        },
        "focus after Enter",
      ).toEqual({
        focusOnChecked: true,
        focusVisible: true,
        indicator: expect.any(String),
      });
      await page.keyboard.press("Escape");
      await expect(languageMenu(page), "the menu closed").toBeHidden();
      expect(
        {
          focusOnControl: await focusedIs(page, control),
          stored: await storedChoice(page),
          htmlLang: await page.locator("html").getAttribute("lang"),
          name: await control
            .getAttribute("aria-label", ACTION)
            .catch(() => null),
        },
        "after Esc",
      ).toEqual({
        focusOnControl: true,
        stored: null,
        htmlLang: "en",
        name: nameBefore,
      });
    },
  );

  await lines.line(
    "Light and dark → the control's text and every option's text meet 4.5:1 against their background; the focus ring meets 3:1 against what is next to it; the checked option is marked by more than colour (its check)",
    async () => {
      const found: string[] = [];
      for (const scheme of ["light", "dark"] as const) {
        try {
          await page.emulateMedia({ colorScheme: scheme });
          await visit(page, traffic, "/");
          await settled(page);
          expect(await tabTo(page, control), "Tab reaches the control").toBe(
            true,
          );
          const controlRing = await focusIndicator(page);
          if (!controlRing || controlRing.ratio < 3)
            found.push(
              `${scheme}: the control's focus ring: ${controlRing?.detail ?? "none"}`,
            );
          await page.keyboard.press("Enter");
          await expect(languageMenu(page)).toBeVisible();
          const optionRing = await focusIndicator(page);
          if (!optionRing || optionRing.ratio < 3)
            found.push(
              `${scheme}: the focused option's ring: ${optionRing?.detail ?? "none"}`,
            );
          const texts = new Set(
            [
              await visibleText(page, control),
              ...(await menuOptions(page).allInnerTexts()),
            ]
              .flatMap((t) => t.split("\n"))
              .map((t) => norm(t).slice(0, 40))
              .filter((t) => t !== ""),
          );
          const contrast = await textContrast(page);
          for (const failure of contrast.failures) {
            const quoted = /^"([^"]*)"/.exec(failure)?.[1];
            if (quoted !== undefined && texts.has(quoted))
              found.push(`${scheme}: ${failure}`);
          }
          const checked = menuOptions(page).and(
            page.locator('[aria-checked="true"]'),
          );
          const unchecked = menuOptions(page)
            .and(page.locator('[aria-checked="false"]'))
            .first();
          const [a, b] = [
            await marks(page, checked),
            await marks(page, unchecked),
          ];
          if (a <= b)
            found.push(
              `${scheme}: the checked option draws ${String(a)} marks, an unchecked one ${String(b)}`,
            );
          await page.keyboard.press("Escape");
        } catch (e) {
          found.push(`${scheme}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});
