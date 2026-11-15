// `studio.checks-browser-language-is-english` (test-criteria.md, issue 17, Flow; requirement R8.1): the Studio flow
// checks run with the browser's language set to English, whatever the machine's language. Observed in the two kinds
// of context a check's page lives in: the default context the check contract gives every check (`page`), and a
// context the checks' own support code opens (`referenceContext` of `support/layers.ts`, the blank pages the AWS area
// is compared against). A check about language sets its own locale; this one sets none.

import { expect, test } from './support';
import { referenceContext } from './support/layers';

/** `navigator.languages` of a blank page, as the page reads it. */
const LANGUAGES = (): string[] => [...navigator.languages];

test('studio.checks-browser-language-is-english', async ({ ctx, page, browser }) => {
  ctx.log(`machine language: LANG=${process.env.LANG ?? '(unset)'} LC_ALL=${process.env.LC_ALL ?? '(unset)'}`);

  // A page opened in a check's default context.
  const ownContext = await page.evaluate(LANGUAGES);
  ctx.log(`default context: navigator.languages ${JSON.stringify(ownContext)}`);

  // A page opened in a context the checks' own support code opens.
  const reference = await referenceContext(browser, 'light');
  let supportContext: string[];
  try {
    const blank = await reference.newPage();
    supportContext = await blank.evaluate(LANGUAGES);
  } finally {
    await reference.close();
  }
  ctx.log(`support code's context: navigator.languages ${JSON.stringify(supportContext)}`);

  expect({ ownContext, supportContext }, 'navigator.languages in each context').toEqual({
    ownContext: ['en-US'],
    supportContext: ['en-US'],
  });
});
