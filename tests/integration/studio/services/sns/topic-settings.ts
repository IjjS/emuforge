import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { type Ctx, EnvError, expect } from '../../support/check';
import { emulatorDir } from '../../support/emulator';
import { ACTION } from '../../support/frame';
import { checkPrefix } from '../../support/service-screens';
import { openTopic, topicScreen } from './sns';

const run = promisify(execFile);

export async function settingsTopic(ctx: Ctx, port: number, prefix: string) {
  const dir = emulatorDir(ctx.home, port);
  async function cli(...args: string[]) {
    const { stdout } = await run('aws', [
      '--endpoint-url', `https://127.0.0.1:${port}`, '--region', 'us-east-1', '--output', 'json', 'sns', ...args,
    ], {
      env: {
        PATH: process.env.PATH, HOME: ctx.home, AWS_CONFIG_FILE: path.join(dir, 'config'),
        AWS_SHARED_CREDENTIALS_FILE: path.join(dir, 'emulator_credentials'), AWS_CA_BUNDLE: path.join(dir, 'ca.pem'),
        AWS_EC2_METADATA_DISABLED: 'true', AWS_PAGER: '',
      },
      timeout: 20_000,
    });
    return stdout;
  }
  const name = checkPrefix(ctx, prefix);
  const { TopicArn: arn } = JSON.parse(await cli('create-topic', '--name', name)) as { TopicArn: string };
  if (!arn) throw new EnvError('SNS create-topic returned no ARN');
  const remove = async () => { await cli('delete-topic', '--topic-arn', arn); };
  ctx.own({ dispose: remove });
  return {
    arn, remove,
    async set(name: string, value: string) {
      await cli('set-topic-attributes', '--topic-arn', arn, '--attribute-name', name, '--attribute-value', value);
    },
    async attributes() {
      const result = JSON.parse(await cli('get-topic-attributes', '--topic-arn', arn));
      return result.Attributes as Record<string, string>;
    },
    async seedTags() {
      await cli('tag-resource', '--resource-arn', arn, '--tags', 'Key=keep,Value=first', 'Key=color,Value=red');
    },
    async tags() {
      const { Tags } = JSON.parse(await cli('list-tags-for-resource', '--resource-arn', arn)) as {
        Tags: { Key: string; Value: string }[];
      };
      return Object.fromEntries(Tags.map(({ Key, Value }) => [Key, Value]));
    },
  };
}

export async function openSettings(page: Page, arn: string) {
  await openTopic(page, arn);
  await topicScreen(page).tab('Settings').click(ACTION);
  const wrapper = createWrapper();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const field = (name: string) => page.getByRole('textbox', { name });
  const table = wrapper.findTable();
  const rows = page.locator(table.findRows().toSelector());
  return {
    button, field, save: button('Save changes'),
    async expectTags(tags: Record<string, string>) {
      const entries = Object.entries(tags);
      await expect(rows).toHaveCount(entries.length);
      const cells = entries.map((_, index) => page.locator(table.findBodyCell(index + 1, 1).toSelector()));
      const byKey = ([a]: string[], [b]: string[]) => a.localeCompare(b);
      await expect.poll(async () => {
        const pairs: string[][] = [];
        for (const cell of cells) {
          const pair: string[] = [];
          for (const label of ['Key', 'Value']) {
            const caption = cell.getByText(label, { exact: true });
            const content = caption.locator('xpath=following-sibling::*[1]');
            if (!await caption.isVisible() || !await content.isVisible()) return undefined;
            pair.push(await content.innerText());
          }
          pairs.push(pair);
        }
        return pairs.sort(byKey);
      }, { message: 'visible Key and Value pairs in the tags table', timeout: 15_000 }).toEqual(entries.sort(byKey));
    },
    dismissSuccess: page.locator(wrapper.findFlashbar().findItemsByType('success').get(1).findDismissButton().toSelector()),
    async confirmRemoval() {
      const modal = wrapper.findModal();
      const content = createWrapper(modal.findContent().toSelector());
      await page.locator(content.findInput().findNativeInput().toSelector()).fill('remove');
      await page.locator(modal.findFooter().findAllButtons().toSelector()).last().click(ACTION);
    },
  };
}
