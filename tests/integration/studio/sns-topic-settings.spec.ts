import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { expectValue, flashItems, sns } from './services/sns/sns';
import { openSettings, settingsTopic } from './services/sns/topic-settings';

test('studio.sns-change-topic-display-name', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const topic = await settingsTopic(ctx, emulatorPort, 'snsname');
  await topic.set('DisplayName', 'External name');
  const ui = await openSettings(page, topic.arn);
  await expectValue(page, 'Display name', 'External name');
  for (const name of ['Changed in Studio', '']) {
    await ui.button('Edit display name').click(ACTION);
    await ui.field('Display name').fill(name);
    await ui.save.click(ACTION);
    await expect(flashItems(page, 'success')).toContainText('Display name saved.');
    await expectValue(page, 'Display name', name || '-');
    expect((await topic.attributes()).DisplayName).toBe(name);
  }
});

test('studio.sns-change-topic-access-policy', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const topic = await settingsTopic(ctx, emulatorPort, 'snspolicy');
  const original = '{"Version":"2012-10-17","Id":"external","Statement":[]}';
  const updated = '{"Version":"2012-10-17","Id":"studio","Statement":[]}';
  await topic.set('Policy', original);
  const ui = await openSettings(page, topic.arn);
  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await ui.button('Edit access policy').click(ACTION);
  const policy = ui.field('Access policy');
  await expect(policy).toHaveValue(original);
  await policy.fill('invalid');
  await ui.save.click(ACTION);
  const error = flashItems(page, 'error');
  await expect(error).toContainText('InvalidParameter');
  await expect(error).toContainText('Invalid parameter: Policy Error: null');
  await expect(policy).toHaveValue('invalid');
  expect((await topic.attributes()).Policy).toBe(original);
  await policy.fill(updated);
  await ui.save.click(ACTION);
  await expect(flashItems(page, 'success')).toContainText('Access policy saved.');
  await expect(page.getByText(updated, { exact: true })).toBeVisible();
  expect((await topic.attributes()).Policy).toBe(updated);
});

test('studio.sns-change-topic-tags', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const topic = await settingsTopic(ctx, emulatorPort, 'snstags');
  await topic.seedTags();
  const ui = await openSettings(page, topic.arn);
  const initial = { keep: 'first', color: 'red' };
  await ui.expectTags(initial);
  await ui.button('Add tag').click(ACTION);
  await ui.field('Key').fill('stage');
  await ui.field('Value').fill('dev');
  await ui.save.click(ACTION);
  const added = { ...initial, stage: 'dev' };
  await expect(flashItems(page, 'success')).toContainText('Tag saved.');
  await ui.expectTags(added);
  expect(await topic.tags()).toEqual(added);

  await ui.button('Edit tag color').click(ACTION);
  await ui.field('Value').fill('blue');
  await ui.save.click(ACTION);
  const edited = { ...added, color: 'blue' };
  await expect(flashItems(page, 'success')).toContainText('Tag saved.');
  await ui.expectTags(edited);
  expect(await topic.tags()).toEqual(edited);

  await ui.button('Remove tag stage').click(ACTION);
  await ui.confirmRemoval();
  await expect(flashItems(page, 'success')).toContainText('Tag removed.');
  const remaining = { keep: 'first', color: 'blue' };
  await ui.expectTags(remaining);
  expect(await topic.tags()).toEqual(remaining);
});

test('studio.sns-change-missing-topic-display-name', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const topic = await settingsTopic(ctx, emulatorPort, 'snsmissing');
  const ui = await openSettings(page, topic.arn);
  await ui.button('Edit display name').click(ACTION);
  await ui.field('Display name').fill('Gone');
  await topic.remove();
  await ui.save.click(ACTION);
  const error = flashItems(page, 'error');
  await expect(error).toContainText('NotFound');
  await expect(error).toContainText('Topic does not exist');
  await expect(flashItems(page, 'success')).toHaveCount(0);
  const direct = await sns(ctx, emulatorPort, 'GetTopicAttributes', { TopicArn: topic.arn });
  expect(direct.code).toBe('NotFound');
});
