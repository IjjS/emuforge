import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { EnvError, expect, startStack, type Ctx } from '../../support';
import { ACTION } from '../../support/frame';
import { checkPrefix } from '../../support/service-screens';
import {
  button, dialogOf, ec2, Ec2Seeded, field, instanceDirect, instancePath, open, tableOf, textAt, world,
} from './ec2';

export const ui = createWrapper();

export async function instanceFixture(ctx: Ctx, label: string, tags?: Record<string, string>) {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = checkPrefix(ctx, label);
  const seeded = new Ec2Seeded(ctx, port, prefix, await world(ctx, port));
  const id = await seeded.instance({ name: prefix, tags });
  const direct = () => instanceDirect(ctx, port, id);
  const call = (operation: string, params: Record<string, string>) => ec2(ctx, port, operation, params);
  const attribute = async (name: string) => {
    const answer = await call('DescribeInstanceAttribute', { InstanceId: id, Attribute: name });
    if (answer.status !== 200) throw new EnvError(`DescribeInstanceAttribute ${name}: ${answer.code}`);
    return textAt(answer.root, name, 'value');
  };
  return { prefix, id, port, seeded, direct, call, attribute,
    open: (page: Page, title = prefix) => open(page, instancePath(id), title),
  };
}

export async function edit(page: Page, launcher: string, title = launcher) {
  await button(page.getByRole('main'), launcher).click(ACTION);
  await expect(page.locator(ui.findModal().findHeader().toSelector())).toHaveText(title);
  return dialogOf(page);
}

export async function submit(page: Page, name = 'Save changes') {
  const action = page.locator(ui.findModal().findFooter().findButton().toSelector()).nth(1);
  await expect(action).toHaveAccessibleName(name);
  await action.click(ACTION);
}

export async function save(page: Page, name?: string) {
  await submit(page, name);
  await expect(dialogOf(page)).toHaveCount(0);
}

export async function userDataField(page: Page) {
  const dialog = await edit(page, 'Edit user data');
  const input = field(dialog, 'User data').getByRole('textbox');
  await expect(input).toBeEditable();
  return input;
}

/** Read the value and its explanation separately from the adjacent editing action and its instructions. */
export async function detailValueParts(page: Page, label: string) {
  const term = page.getByRole('main').locator('dt').filter({ hasText: new RegExp('^' + label + '$') });
  const definition = term.locator('xpath=following-sibling::dd[1]');
  return definition.evaluate(element => {
    const content = element.cloneNode(true) as HTMLElement;
    content.querySelector('[data-testid="instance-attribute-action"]')?.remove();
    return [...content.querySelectorAll('*')]
      .filter(part => part.childElementCount === 0)
      .map(part => part.textContent?.trim())
      .filter(Boolean);
  });
}

/** Read each tag key and value from the same rendered row, excluding only the key cell's buttons. */
export async function tagRows(page: Page) {
  const table = tableOf(page.getByRole('main'), 'Tags');
  const rowSelector = ui.findTable().findRows().toSelector();
  const rows = page.locator(rowSelector).and(table.locator('tr'));
  return rows.evaluateAll(elements => elements.map(row => {
    const keyCell = row.children[0]!.cloneNode(true) as HTMLElement;
    keyCell.querySelectorAll('button').forEach(button => button.remove());
    return { Key: keyCell.textContent?.trim() ?? '', Value: row.children[1]!.textContent?.trim() ?? '' };
  }));
}
