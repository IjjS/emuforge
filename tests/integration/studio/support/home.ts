// What Home's "Connection" container shows, read from the page the way a user reads it: the "Engine" and
// "Emulator" rows (the status indicator's text and the row's text), and the text of the alert inside the container
// (requirement 2.1, 3.2). Used by the Home checks of issue 3 (`home.spec.ts`, `safety.spec.ts`).

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

const CONTAINER = createWrapper().findContainer().toSelector();
const STATUS_INDICATOR = createWrapper().findStatusIndicator().toSelector();
const ALERT = createWrapper().findAlert().toSelector();

/** One row of the "Connection" container. */
export interface RowView {
  /** The text of the row's status indicator; `null` when the row has none, or more than one. */
  status: string | null;
  /** All visible text of the row, whitespace collapsed: the label, the status and the endpoint. */
  text: string;
}

export interface ConnectionView {
  /** The "Engine" row; `null` when the page has no "Connection" container or no row labelled "Engine". */
  engine: RowView | null;
  /** The "Emulator" row; `null` likewise. */
  emulator: RowView | null;
  /** How many alerts the container holds. */
  alerts: number;
  /** The visible text of the container's alerts, whitespace collapsed; `''` when it holds none. */
  alert: string;
}

/**
 * Reads the "Connection" container once. A row is the smallest element that holds the element whose text is exactly
 * the row's label and a status indicator. Never waits: a page without the container reads as `null` rows.
 */
export async function connectionView(page: Page): Promise<ConnectionView> {
  return page.evaluate(
    ({ container, indicator, alert }) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const visible = (el: Element) => norm((el as HTMLElement).innerText);
      const containers = [...document.querySelectorAll(container)].filter((c) =>
        [...c.querySelectorAll('h1, h2, h3, h4, h5, h6')].some((h) => norm(h.textContent) === 'Connection'),
      );
      const box = containers.at(-1);
      if (!box) return { engine: null, emulator: null, alerts: 0, alert: '' };
      const row = (label: string) => {
        const labels = [...box.querySelectorAll('*')].filter(
          (el) =>
            norm(el.textContent) === label && ![...el.children].some((child) => norm(child.textContent) === label),
        );
        const own = labels.find((el) => !el.closest(alert));
        if (!own) return null;
        let scope: Element | null = own.parentElement;
        while (scope && scope !== box && scope.querySelectorAll(indicator).length === 0) scope = scope.parentElement;
        if (!scope) return null;
        const found = scope.querySelectorAll(indicator);
        return { status: found.length === 1 ? norm(found[0].textContent) : null, text: visible(scope) };
      };
      const alerts = [...box.querySelectorAll(alert)];
      return {
        engine: row('Engine'),
        emulator: row('Emulator'),
        alerts: alerts.length,
        alert: alerts.map(visible).join(' '),
      };
    },
    { container: CONTAINER, indicator: STATUS_INDICATOR, alert: ALERT },
  );
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

/** The 19 service labels of requirement 2.2, in label order, as the side navigation lists them. */
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
