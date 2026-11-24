import type { Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { ACTION } from './support/frame';
import { checkPrefix } from './support/service-screens';
import {
  answered, flashItems, openTopic, readSubscriptionSettings, SnsSeeded, subscriptionSettingsScreen,
  valueOf, writeSubscriptionSetting,
} from './services/sns/sns';

const red = '{"color":["red"]}';
const blue = '{"color":["blue"]}';
const green = '{"color":["green"]}';
const initial = { policy: red, scope: 'MessageBody', raw: 'true' };

async function openSeededSettings(ctx: Ctx, page: Page, tag: string) {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = checkPrefix(ctx, tag);
  const seed = new SnsSeeded(ctx, port, prefix);
  const topic = await seed.topic(`${prefix}-topic`);
  const queue = await seed.queue(`${prefix}-queue`);
  const arn = await seed.subscribe(topic, 'sqs', queue.arn);
  const write = (name: string, value: string) => writeSubscriptionSetting(ctx, port, arn, name, value);
  for (const [name, value] of Object.entries({
    FilterPolicy: red, FilterPolicyScope: initial.scope, RawMessageDelivery: initial.raw,
  })) {
    expect((await write(name, value)).status).toBe(200);
  }
  const ui = subscriptionSettingsScreen(page);
  const read = () => readSubscriptionSettings(ctx, port, arn);
  await openTopic(page, topic);
  await ui.row.click(ACTION);
  await ui.open.click(ACTION);
  await expect.poll(() => valueOf(ui.editor, 'Endpoint')).toBe(queue.arn);

  async function expectShown(state: Awaited<ReturnType<typeof read>>) {
    await expect(ui.policy).toHaveValue(state.policy ?? '');
    if (state.policy === undefined) await expect(ui.policyDescription).toHaveText('No filter policy');
    const scopes: Record<string, string> = { MessageBody: 'Message body', MessageAttributes: 'Message attributes' };
    await expect(ui.scope).toHaveText(state.scope === undefined ? 'Not set' : scopes[state.scope] ?? state.scope);
    await expect(ui.raw).toHaveText(state.raw === 'true' ? 'On' : 'Off');
  }
  async function expectState(state: Awaited<ReturnType<typeof read>>) {
    expect(await read()).toEqual(state);
    await expectShown(state);
  }
  await expectState(initial);
  // The draft can already display the submitted value before the write and its readback finish.
  const save = (button: typeof ui.savePolicy) => answered(page, 'GetSubscriptionAttributes', () => button.click(ACTION));
  return { ui, read, write, save, expectState, expectShown };
}

test('studio.sns-subscription-filter-policy-and-scope', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const { ui, read, save, expectState, expectShown } = await openSeededSettings(ctx, page, 'snsfilter');
  await ui.policy.fill(blue);
  await save(ui.savePolicy);
  await expectState({ ...initial, policy: blue });
  for (const scope of ['MessageAttributes', 'MessageBody']) {
    await ui.scope.click(ACTION);
    await ui.choose(scope);
    await save(ui.saveScope);
    await expectState({ ...initial, policy: blue, scope });
  }

  await ui.clear.click(ACTION);
  await ui.cancel.click(ACTION);
  await expect(ui.modal).toBeHidden();
  await expectState({ ...initial, policy: blue });
  await ui.clear.click(ACTION);
  await save(ui.confirm);
  await expect(ui.modal).toBeHidden();
  await expectState({ policy: undefined, scope: undefined, raw: 'true' });

  await ui.policy.fill(green);
  await save(ui.savePolicy);
  const recreated = await read();
  expect(recreated.policy).toBe(green);
  expect(recreated.raw).toBe('true');
  await expectShown(recreated);
});

test('studio.sns-subscription-raw-delivery', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const { ui, save, expectState } = await openSeededSettings(ctx, page, 'snsraw');
  for (const raw of ['false', 'true']) {
    await ui.raw.click(ACTION);
    await ui.choose(raw);
    await save(ui.saveRaw);
    await expectState({ ...initial, raw });
  }
});

test('studio.sns-subscription-settings-refusal', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const { ui, read, write, save, expectState } = await openSeededSettings(ctx, page, 'snsrefuse');
  const malformed = 'broken';
  const refusal = await write('FilterPolicy', malformed);
  expect(refusal.status).toBe(400);
  expect(refusal.code).toBe('InvalidParameter');
  expect(refusal.message).toBeTruthy();

  await ui.policy.fill(malformed);
  await ui.savePolicy.click(ACTION);
  const flash = flashItems(page, 'error');
  await expect(flash).toContainText('InvalidParameter');
  await expect(flash).toContainText(refusal.message!);
  expect(await read()).toEqual(initial);
  await ui.policy.fill(blue);
  await save(ui.savePolicy);
  await expectState({ ...initial, policy: blue });
});
