import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { flashItems, sns, valueOf } from './services/sns/sns';
import { openSettings, settingsTopic } from './services/sns/topic-settings';

test('studio.sns-change-topic-display-name', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const topic = await settingsTopic(ctx, emulatorPort, 'snsname');
  await topic.set('DisplayName', 'External name');
  const ui = await openSettings(page, topic.arn);
  const displayedName = () => valueOf(page.getByRole('main'), 'Display name');
  await expect.poll(displayedName).toBe('External name');
  for (const name of ['Changed in Studio', '']) {
    await ui.button('Edit display name').click(ACTION);
    await ui.field('Display name').fill(name);
    await ui.save.click(ACTION);
    if (name !== '') {
      const success = flashItems(page, 'success');
      await expect(success).toHaveText(['Display name saved.']);
      await expect(success).toBeVisible();
    }
    await expect.poll(displayedName).toBe(name || '-');
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
  await expect(error).toBeVisible();
  await expect(error).toContainText('InvalidParameter');
  await expect(error).toContainText('Invalid parameter: Policy Error: null');
  await expect(policy).toHaveValue('invalid');
  expect((await topic.attributes()).Policy).toBe(original);
  await policy.fill(updated);
  await ui.save.click(ACTION);
  const success = flashItems(page, 'success');
  await expect(success).toHaveText(['Access policy saved.']);
  await expect(success).toBeVisible();
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
  const success = flashItems(page, 'success');
  await expect(success).toHaveText(['Tag saved.']);
  await expect(success).toBeVisible();
  await ui.expectTags(added);
  expect(await topic.tags()).toEqual(added);
  await ui.dismissSuccess.click(ACTION);
  await expect(success).toHaveCount(0);

  await ui.button('Edit tag color').click(ACTION);
  await ui.field('Value').fill('blue');
  await ui.save.click(ACTION);
  const edited = { ...added, color: 'blue' };
  await expect(success).toHaveText(['Tag saved.']);
  await expect(success).toBeVisible();
  await ui.expectTags(edited);
  expect(await topic.tags()).toEqual(edited);

  await ui.button('Remove tag stage').click(ACTION);
  await ui.confirmRemoval();
  await expect(success).toHaveText(['Tag removed.']);
  await expect(success).toBeVisible();
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
  await expect(error).toBeVisible();
  await expect(error).toContainText('NotFound');
  await expect(error).toContainText('Topic does not exist');
  await expect(flashItems(page, 'success')).toHaveCount(0);
  const direct = await sns(ctx, emulatorPort, 'GetTopicAttributes', { TopicArn: topic.arn });
  expect(direct.code).toBe('NotFound');
});
