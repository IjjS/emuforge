// What the create and modify forms of more than one service share on the screen and on the emulator (issue 651): the
// "Tags - optional" section of the area, a Cloudscape attribute editor; the options of a select or a multiselect,
// found by value; and the KMS keys a check makes for a form's key choice. A service's own fields, words and direct
// calls stay in its folder.
//
// An option is found by its value with Cloudscape's test selectors and its texts are asserted on the option found.
// "Not offered" is read on the settled list: the option that must be there is shown (or the list's own empty or
// no-match words), and no option of the other value is.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator } from '@playwright/test';

import { directKms } from './aws-clients-general';
import { EnvError, expect, type Ctx } from './check';
import { ACTION } from './frame';

const wrapper = createWrapper();
function rel(selector: { toSelector(): string }): string {
  return selector.toSelector().replace(/^body /, '');
}
function inside(selector: { toSelector(): string }): string {
  return rel(selector).replace(/^\[class\*="awsui_root_\w+"\] /, '');
}

const EDITOR = rel(wrapper.findAttributeEditor());
const EDITOR_ADD = inside(wrapper.findAttributeEditor().findAddButton());
const EDITOR_ROWS = inside(wrapper.findAttributeEditor().findRows());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const SELECT_FILTER = inside(wrapper.findSelect().findFilteringInput().findNativeInput());
const MULTISELECT = rel(wrapper.findMultiselect());
const MULTISELECT_TRIGGER = inside(wrapper.findMultiselect().findTrigger());
const MULTISELECT_OPEN = inside(wrapper.findMultiselect().findDropdown().findOpenDropdown());
const MULTISELECT_FILTER = inside(wrapper.findMultiselect().findFilteringInput().findNativeInput());
const MULTISELECT_TOKENS = inside(wrapper.findMultiselect().findTokens());
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}

/** How long a list may take to show an option its read has to bring. */
export const OPTION_BOUND_MS = 20_000;

/** Adds a row to the tags section inside `scope` and enters `key` and `value` in it. */
export async function addTag(scope: Locator, key: string, value: string): Promise<void> {
  const editor = scope.locator(EDITOR).last();
  const rows = editor.locator(EDITOR_ROWS);
  const before = await rows.count();
  await editor.locator(EDITOR_ADD).click(ACTION);
  await expect(rows, 'the tag rows after "Add tag"').toHaveCount(before + 1);
  const inputs = rows.nth(before).getByRole('textbox');
  await inputs.nth(0).fill(key, ACTION);
  await inputs.nth(1).fill(value, ACTION);
}

/** The keys and values the tags section inside `scope` holds, in order. */
export async function tagsShown(scope: Locator): Promise<[string, string][]> {
  const rows = scope.locator(EDITOR).last().locator(EDITOR_ROWS);
  const shown: [string, string][] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const inputs = rows.nth(i).getByRole('textbox');
    shown.push([await inputs.nth(0).inputValue(), await inputs.nth(1).inputValue()]);
  }
  return shown;
}

/** The open list of the select or multiselect of a form field, with what a check does in it. */
export interface OpenList {
  /** The option of `value`. */
  option(value: string): Locator;
  /** Waits for the option of `value` and asserts that it holds every text of `texts`. */
  expectOption(value: string, ...texts: string[]): Promise<void>;
  /** Asserts, on the list as it stands, that no option has one of `values`. */
  expectNone(...values: string[]): Promise<void>;
  /** Waits until the list itself says `text` (its empty, no-match or end words). */
  expectSays(text: string): Promise<void>;
  /** Types `text` in the list's filter. */
  type(text: string): Promise<void>;
  /** Chooses the option of `value`. A select closes; a multiselect stays open. */
  choose(value: string): Promise<void>;
  /** Closes the list without a choice. */
  close(): Promise<void>;
}

function listOf(root: Locator, parts: { trigger: string; open: string; filter: string }): OpenList {
  const list = root.locator(parts.open);
  const option = (value: string) => root.locator(optionByValue(value));
  return {
    option,
    async expectOption(value, ...texts) {
      await expect(option(value), `the option ${value}`).toBeVisible({ timeout: OPTION_BOUND_MS });
      for (const text of texts) await expect(option(value), `the option ${value} shows "${text}"`).toContainText(text);
    },
    async expectNone(...values) {
      for (const value of values) await expect(option(value), `no option ${value}`).toHaveCount(0);
    },
    async expectSays(text) {
      await expect(list, `the list says "${text}"`).toContainText(text, { timeout: OPTION_BOUND_MS });
    },
    async type(text) {
      await root.locator(parts.filter).fill(text, ACTION);
    },
    async choose(value) {
      await expect(option(value), `the option ${value}`).toBeVisible({ timeout: OPTION_BOUND_MS });
      await option(value).click(ACTION);
    },
    async close() {
      if ((await list.count()) === 0) return;
      await root.page().keyboard.press('Escape');
      await expect(list, 'the list after Escape').toHaveCount(0);
    },
  };
}

/** Opens the select of `formField`. */
export async function openSelect(formField: Locator): Promise<OpenList> {
  const root = formField.locator(SELECT).first();
  if ((await root.locator(SELECT_OPEN).count()) === 0) await root.locator(SELECT_TRIGGER).click(ACTION);
  await expect(root.locator(SELECT_OPEN), 'the open list').toBeVisible();
  return listOf(root, { trigger: SELECT_TRIGGER, open: SELECT_OPEN, filter: SELECT_FILTER });
}

/** Opens the multiselect of `formField`. */
export async function openMultiselect(formField: Locator): Promise<OpenList> {
  const root = formField.locator(MULTISELECT).first();
  if ((await root.locator(MULTISELECT_OPEN).count()) === 0) await root.locator(MULTISELECT_TRIGGER).click(ACTION);
  await expect(root.locator(MULTISELECT_OPEN), 'the open list').toBeVisible();
  return listOf(root, { trigger: MULTISELECT_TRIGGER, open: MULTISELECT_OPEN, filter: MULTISELECT_FILTER });
}

/** The select's trigger of `formField`: what it shows as chosen, and whether it can be opened. */
export function triggerOf(formField: Locator): Locator {
  return formField.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** The chosen items of the multiselect of `formField`. */
export function chosenOf(formField: Locator): Locator {
  return formField.locator(MULTISELECT).first().locator(MULTISELECT_TOKENS);
}

/** A KMS key a check made. */
export interface MadeKey {
  id: string;
  arn: string;
}

/**
 * `CreateKey` on the emulator on `port`, with an alias (`alias/<name>`) or a description, disabled when asked. The
 * API has no immediate delete of a key, so the check runs on an emulator of its own and nothing is scheduled.
 */
export async function makeKey(
  ctx: Ctx,
  port: number,
  make: { alias?: string; description?: string; disabled?: boolean },
): Promise<MadeKey> {
  const call = async (action: string, input: object) => {
    const answer = await directKms(ctx, port, action, input);
    if ('error' in answer) throw new EnvError(`direct ${action}: ${answer.error}`);
    ctx.log(`direct kms ${action}: status ${String(answer.status)}`);
    if (answer.status !== 200) throw new EnvError(`direct ${action} answered ${String(answer.status)}`);
    return JSON.parse(answer.body === '' ? '{}' : answer.body) as { KeyMetadata?: { KeyId?: string; Arn?: string } };
  };
  const created = await call('CreateKey', make.description === undefined ? {} : { Description: make.description });
  const id = created.KeyMetadata?.KeyId;
  const arn = created.KeyMetadata?.Arn;
  if (id === undefined || arn === undefined) throw new EnvError('the emulator gave the key no id or ARN');
  if (make.alias !== undefined) await call('CreateAlias', { AliasName: make.alias, TargetKeyId: id });
  if (make.disabled === true) await call('DisableKey', { KeyId: id });
  return { id, arn };
}
