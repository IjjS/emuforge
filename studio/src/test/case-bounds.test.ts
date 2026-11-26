// @vitest-environment node
// The bounds of Studio's unit cases (issue 469, requirement point 4; test-criteria.md, "Unit s1 —
// studio/src/test/case-bounds.test.ts"): the scan of `case-bounds.ts`, first on test-file text given by the modules
// under `case-bounds/`, then on every test file under `studio/src/` as it is on the branch.

import { describe, expect, it } from 'vitest';

import {
  AREA_WAIT_FILES,
  raisedBounds,
  readStudioFile,
  scanCaseBounds,
  scanRepository,
  scanWaitBounds,
} from './case-bounds';
import * as notRaised from './case-bounds/not-raised';
import * as raised from './case-bounds/raised';
import * as refused from './case-bounds/refused';
import * as waits from './case-bounds/waits';

const FILE = 'src/given.test.ts';

/** The lines the scan names in a given source. */
function namedLines(source: string): number[] {
  return scanCaseBounds(source, FILE).map((finding) => finding.line);
}

/** The 1-based line of the first line of `source` that starts, after its indent, with `start`. */
function lineStarting(source: string, start: string): number {
  const at = source.split('\n').findIndex((line) => line.trimStart().startsWith(start));
  expect(at, `a line starting ${start}`).toBeGreaterThanOrEqual(0);
  return at + 1;
}

describe('a raised case bound', () => {
  it('closed by `}, 20_000);` with no comment above its `it(` → one finding naming the line of its `it(`', () => {
    const findings = scanCaseBounds(raised.CLOSING_LINE, FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: FILE, line: lineStarting(raised.CLOSING_LINE, 'it(') });
  });

  it('the same with `// Bound: <reason>` directly above its `it(` → no finding', () => {
    expect(scanCaseBounds(raised.CLOSING_LINE_COMMENTED, FILE)).toEqual([]);
  });

  it('`10000,` on a line of its own before `);`, no comment → one finding', () => {
    expect(namedLines(raised.OWN_LINE)).toEqual([lineStarting(raised.OWN_LINE, 'it(')]);
  });

  it('the same with `// Bound: <reason>` directly above → no finding', () => {
    expect(scanCaseBounds(raised.OWN_LINE_COMMENTED, FILE)).toEqual([]);
  });

  it('`{ timeout: 60_000 }` as the second argument, no comment → one finding', () => {
    expect(namedLines(raised.OPTIONS)).toEqual([lineStarting(raised.OPTIONS, 'it(')]);
  });

  it('the same with `// Bound: <reason>` directly above → no finding', () => {
    expect(scanCaseBounds(raised.OPTIONS_COMMENTED, FILE)).toEqual([]);
  });

  it('`{ timeout: SLOW }`, a name, no comment → one finding', () => {
    expect(namedLines(raised.OPTIONS_NAMED)).toEqual([lineStarting(raised.OPTIONS_NAMED, 'it(')]);
  });

  it('closed by `}, SLOW);`, a name as the third argument, no comment → one finding', () => {
    expect(namedLines(raised.CLOSING_LINE_NAMED)).toEqual([lineStarting(raised.CLOSING_LINE_NAMED, 'it(')]);
  });

  it('under a comment that does not start `// Bound:` → one finding', () => {
    expect(namedLines(raised.OTHER_COMMENT)).toEqual([lineStarting(raised.OTHER_COMMENT, 'it(')]);
  });

  it('`// Bound: <reason>` with a blank line before the `it(` → one finding', () => {
    expect(namedLines(raised.COMMENT_APART)).toEqual([lineStarting(raised.COMMENT_APART, 'it(')]);
  });
});

describe('not a raised case bound', () => {
  it('a `setTimeout(() => { … }, 20_000);` of several lines inside a case with no bound → no finding', () => {
    expect(scanCaseBounds(notRaised.INNER_TIMER, FILE)).toEqual([]);
  });

  it('a `vi.waitFor(async () => { … }, AREA_LOAD);` of several lines inside a case with no bound → no finding', () => {
    expect(scanCaseBounds(notRaised.INNER_WAIT_FOR, FILE)).toEqual([]);
  });

  it('`}, 5000);` and `{ timeout: 5_000 }` → no finding', () => {
    expect(scanCaseBounds(notRaised.AT_DEFAULT, FILE)).toEqual([]);
  });

  it('`findByRole(…, {}, { timeout: 10_000 })` and `waitFor(…, { timeout: 10_000 })` inside a case → no finding', () => {
    expect(scanCaseBounds(notRaised.INNER_FIND_AND_WAIT, FILE)).toEqual([]);
  });
});

describe('what raises many bounds at once, with a `// Bound:` comment or not', () => {
  it('`describe(…, { timeout: 9000 }, …)` → one finding', () => {
    expect(namedLines(refused.SUITE_TIMEOUT)).toEqual([lineStarting(refused.SUITE_TIMEOUT, 'describe(')]);
    expect(namedLines(refused.SUITE_TIMEOUT_COMMENTED)).toEqual([
      lineStarting(refused.SUITE_TIMEOUT_COMMENTED, 'describe('),
    ]);
  });

  it('`vi.setConfig(…)` with the Vitest setting of the default bound → one finding', () => {
    expect(namedLines(refused.SET_CONFIG)).toEqual([lineStarting(refused.SET_CONFIG, 'vi.setConfig(')]);
    expect(namedLines(refused.SET_CONFIG_COMMENTED)).toEqual([
      lineStarting(refused.SET_CONFIG_COMMENTED, 'vi.setConfig('),
    ]);
  });

  it('the Vitest setting of the default bound named anywhere else in a file → one finding', () => {
    expect(namedLines(refused.SETTING_NAMED)).toEqual([lineStarting(refused.SETTING_NAMED, 'const options')]);
  });
});

describe('a wait above the default case bound', () => {
  it.each([
    ['a findBy call in a case', waits.FIND_BY, 'await screen.findByRole'],
    ['a named options object', waits.NAMED_OPTIONS, 'await vi.waitFor'],
    ['a named timeout in options', waits.NAMED_TIMEOUT, 'await screen.findByRole'],
    ['a timeout name shadowed in another case', waits.SHADOWED_TIMEOUT, 'await vi.waitFor'],
    ['a wait in a helper', waits.HELPER, 'return screen.findByRole'],
    ['a wait in a hook', waits.HOOK, 'await screen.findByRole'],
    ['a waitFor call', waits.WAIT_FOR, 'await waitFor('],
    ['a quoted timeout property', waits.QUOTED_TIMEOUT, 'await waitFor('],
    ['a findAllBy call', waits.FIND_ALL_BY, 'await screen.findAllByRole'],
    ['an unbound findBy call', waits.UNBOUND_QUERY, 'await findByRole'],
    ['a waitForElementToBeRemoved call', waits.WAIT_FOR_REMOVAL, 'await waitForElementToBeRemoved'],
  ])('names the call for %s', (_label, source, start) => {
    expect(scanWaitBounds(source, FILE)).toEqual([
      expect.objectContaining({ file: FILE, line: lineStarting(source, start) }),
    ]);
  });

  it('names vi.waitFor calls with a number or a name directly as the second argument', () => {
    const first = lineStarting(waits.DIRECT_TIMEOUT, 'await vi.waitFor');
    expect(scanWaitBounds(waits.DIRECT_TIMEOUT, FILE).map(({ line }) => line)).toEqual([first, first + 1]);
  });

  it('accepts waits at or below 5000 ms and waits with no options', () => {
    expect(scanWaitBounds(waits.SHORT_WAITS, FILE)).toEqual([]);
  });

  it('ignores timeouts that are not wait options', () => {
    expect(scanWaitBounds(waits.OTHER_TIMEOUTS, FILE)).toEqual([]);
  });

  it('ignores the query options of bound and unbound findBy and findAllBy calls', () => {
    expect(scanWaitBounds(waits.QUERY_OPTIONS, FILE)).toEqual([]);
  });
});

describe('the repository', () => {
  it('every test file under studio/src/ as it is on the branch → no finding', () => {
    expect(scanRepository()).toEqual([]);
  });

  it('the fifty-tag cases and the create-role page → no case bound above 5000 ms, commented or not', () => {
    for (const file of [
      'src/providers/aws/area/services/s3/components/bucket-tags.test.tsx',
      'src/providers/aws/area/services/iam/components/role-tags.test.tsx',
      'src/providers/aws/area/services/iam/pages/create-role-page.test.tsx',
    ]) {
      expect(raisedBounds(readStudioFile(file)), file).toEqual([]);
    }
  });

  it.each(AREA_WAIT_FILES)('%s → no wait above 5000 ms', (file) => {
    expect(scanWaitBounds(readStudioFile(file), file)).toEqual([]);
  });

  it('the six suites opening the AWS area → no case bound above 5000 ms, commented or not', () => {
    for (const file of [
      'src/app/app.test.tsx',
      'src/app/frame.test.tsx',
      'src/app/routes.test.tsx',
      'src/features/home/home-languages.test.tsx',
      'src/providers/aws/area/services/kms/pages/key.test.tsx',
      'src/providers/aws/area/services/kms/pages/keys.test.tsx',
    ]) {
      expect(raisedBounds(readStudioFile(file)), file).toEqual([]);
    }
  });
});
