// What Home's "Connection" section shows, read from the page the way a user reads it, in Studio's own elements found
// by role and name (requirement R9.1, R9.3; test-criteria.md, issue 16): the region named "Connection", its "Engine"
// and "Emulator" rows (the row's status text and all its text) and the notices under the rows, each named by its
// heading. Used by the Home checks of issues 3 and 16 (`home.spec.ts`, `safety.spec.ts`).

import type { Page } from '@playwright/test';

/** The status texts a row shows (requirement R9.1). */
export const STATUSES = ['Checking', 'Connected', 'Not started', 'Unreachable', 'Error', 'Unknown'];

/** One row of the "Connection" section. */
export interface RowView {
  /** The row's status text; `null` when the row shows none of `STATUSES`, or more than one. */
  status: string | null;
  /** All visible text of the row, whitespace collapsed: the label, the status and the address. */
  text: string;
}

export interface ConnectionView {
  /** The "Engine" row; `null` when the page has no Studio "Connection" region or no row labelled "Engine". */
  engine: RowView | null;
  /** The "Emulator" row; `null` likewise. */
  emulator: RowView | null;
  /** How many notices the section holds. */
  notices: number;
  /** The visible text of the section's notices, whitespace collapsed; `''` when it holds none. */
  notice: string;
}

/**
 * Reads the "Connection" section once. Never waits: a page without it reads as `null` rows.
 *
 * - The section is the element with role `region` and accessible name "Connection" that is Studio's own: neither it
 *   nor an element around it carries a Cloudscape class (a class starting with `awsui`).
 * - A notice is the largest element inside the section that holds a heading other than "Connection" and none of the
 *   rows' labels.
 * - A row is the smallest element around the element whose text is exactly the row's label (outside every notice)
 *   that also holds an element whose text is exactly one of `STATUSES`.
 */
export async function connectionView(page: Page): Promise<ConnectionView> {
  const regions = page.getByRole('region', { name: 'Connection', exact: true });
  const views = await regions.evaluateAll((found, statuses) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el: Element) => norm((el as HTMLElement).innerText);
    const cloudscape = (el: Element | null): boolean => {
      for (let at = el; at; at = at.parentElement) {
        if ([...at.classList].some((c) => c.startsWith('awsui'))) return true;
      }
      return false;
    };
    const box = found.filter((r) => !cloudscape(r)).at(-1);
    if (!box) return null;
    const exactly = (text: string) =>
      [...box.querySelectorAll('*')].filter(
        (el) => norm(el.textContent) === text && ![...el.children].some((child) => norm(child.textContent) === text),
      );
    const labels = [...exactly('Engine'), ...exactly('Emulator')];
    const headings = [...box.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].filter(
      (h) => norm(h.textContent) !== 'Connection',
    );
    const notices: Element[] = [];
    for (const heading of headings) {
      let el: Element = heading;
      while (el.parentElement && el.parentElement !== box && !labels.some((l) => el.parentElement!.contains(l))) {
        el = el.parentElement;
      }
      if (labels.some((l) => el.contains(l))) continue;
      if (!notices.some((n) => n.contains(el))) notices.push(el);
    }
    const row = (label: string) => {
      const own = exactly(label).find((el) => !notices.some((n) => n.contains(el)));
      if (!own) return null;
      for (let scope = own.parentElement; scope && box.contains(scope); scope = scope.parentElement) {
        const shown = [...scope.querySelectorAll('*')].filter(
          (el) =>
            !notices.some((n) => n.contains(el)) &&
            statuses.includes(norm(el.textContent)) &&
            ![...el.children].some((child) => norm(child.textContent) === norm(el.textContent)),
        );
        if (shown.length === 0) continue;
        const distinct = [...new Set(shown.map((el) => norm(el.textContent)))];
        return { status: distinct.length === 1 ? distinct[0] : null, text: visible(scope) };
      }
      return null;
    };
    return {
      engine: row('Engine'),
      emulator: row('Emulator'),
      notices: notices.length,
      notice: notices.map(visible).join(' '),
    };
  }, STATUSES);
  return views ?? { engine: null, emulator: null, notices: 0, notice: '' };
}

/** A pattern matching `<flag> <port>` not followed by another digit, as a command line names a port. */
export function flagWithPort(flag: string, port: number): RegExp {
  return new RegExp(`${flag.replace(/[-]/g, '\\-')} ${String(port)}(?!\\d)`);
}

/**
 * Leaves a mark in the page's window. `stillSamePage` is true only while that document is the one shown: a reload
 * or a full navigation drops the mark. Proves "without reloading the page".
 */
export async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __emuforgeItMark?: boolean }).__emuforgeItMark = true;
  });
}

export async function stillSamePage(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __emuforgeItMark?: boolean }).__emuforgeItMark === true);
}

/** The 19 service labels (requirement R5.2, R9.2), in label order, as the AWS area and Home's "Providers" list them. */
export const SERVICE_LABELS = [
  'Amazon API Gateway',
  'Amazon CloudWatch',
  'Amazon CloudWatch Logs',
  'Amazon DynamoDB',
  'Amazon Elastic Compute Cloud',
  'Amazon Elastic Container Registry',
  'Amazon EventBridge',
  'Amazon Kinesis',
  'Amazon Route 53',
  'Amazon Simple Notification Service',
  'Amazon Simple Queue Service',
  'Amazon Simple Storage Service',
  'Amazon Simple Systems Manager (SSM)',
  'AWS CloudFormation',
  'AWS Identity and Access Management',
  'AWS Key Management Service',
  'AWS Lambda',
  'AWS Secrets Manager',
  'AWS Step Functions',
];

/** The lines of the start command for `port` (requirement 3.3), trimmed. */
export function startCommandLines(port: number): string[] {
  return [
    'E=$HOME/.aws/emulator',
    `P=${String(port)}`,
    'docker run -d \\',
    '--name \\',
    'emuforge-emulator-$P \\',
    '-p 127.0.0.1:$P:$P \\',
    '-e HOME=$HOME \\',
    '-v $E:$E \\',
    'aws-emulator \\',
    '-p $P -t off',
  ];
}

/**
 * The lines of the engine command (requirement 3.2, 3.3) shown after a first check that got no answer, trimmed. The
 * last one is matched without its continuation: whether `--emulator-port` follows depends on earlier answers.
 */
export function engineCommandLines(enginePort: number, studioPort: number): string[] {
  return [
    'cargo run \\',
    '-p emuforge-server -- \\',
    `--port ${String(enginePort)} \\`,
    `--studio-port ${String(studioPort)}`,
  ];
}

export interface LayoutIssues {
  /** The page itself scrolls sideways. */
  pageScrolls: boolean;
  /** Visible elements that scroll sideways (`overflow-x` auto or scroll, content wider than the box). */
  scrolling: string[];
  /** Command lines that take more than one line on screen. */
  wrapped: string[];
  /** Command lines that are not shown on the page at all. */
  missing: string[];
}

/**
 * Measures the page as it is drawn now: sideways scrolling of the page and of any visible element, and for each of
 * `lines` the first visible place where that text is drawn, which must sit on one line (its boxes overlap
 * vertically). Text split over several elements (highlighting, one element per line) is followed across them.
 */
export async function layoutIssues(page: Page, lines: string[]): Promise<LayoutIssues> {
  return page.evaluate((wanted) => {
    const root = document.documentElement;
    const out = {
      pageScrolls: root.scrollWidth > root.clientWidth,
      scrolling: [] as string[],
      wrapped: [] as string[],
      missing: [] as string[],
    };
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
      if (el.getClientRects().length === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.scrolling.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
        );
      }
    }
    const nodes: { node: Text; start: number }[] = [];
    let flat = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: flat.length });
      flat += (n as Text).data;
    }
    const at = (offset: number): [Text, number] => {
      let i = nodes.length - 1;
      while (i > 0 && nodes[i].start > offset) i--;
      return [nodes[i].node, offset - nodes[i].start];
    };
    for (const line of wanted) {
      let shown = false;
      for (let from = flat.indexOf(line); from >= 0 && !shown; from = flat.indexOf(line, from + 1)) {
        const range = document.createRange();
        const [startNode, startOffset] = at(from);
        const [endNode, endOffset] = at(from + line.length - 1);
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset + 1);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length === 0) continue;
        shown = true;
        const top = Math.min(...rects.map((r) => r.top));
        const firstBottom = Math.min(...rects.filter((r) => r.top === top).map((r) => r.bottom));
        if (rects.some((r) => r.top >= firstBottom - 1)) out.wrapped.push(line);
      }
      if (!shown) out.missing.push(line);
    }
    return out;
  }, lines);
}
