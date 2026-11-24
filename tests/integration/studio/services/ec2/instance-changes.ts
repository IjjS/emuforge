import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
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

export function nativeInput(scope: Locator) {
  return scope.locator(ui.findInput().findNativeInput().toSelector().replace(/^body /, ''));
}

export async function userDataField(page: Page) {
  const dialog = await edit(page, 'Edit user data');
  const input = field(dialog, 'User data').locator(ui.findTextarea().findNativeTextarea().toSelector().replace(/^body /, ''));
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
  const wrapper = ui.findTable();
  const selectors = {
    headers: wrapper.findColumnHeaders().toSelector(),
    rows: wrapper.findRows().toSelector(),
    cell: wrapper.findBodyCell(987654, 123456).toSelector(),
  };
  return table.evaluate((root, selectors) => {
    const headers = [...root.querySelectorAll(selectors.headers)].map(header => header.textContent?.trim());
    const keyColumn = headers.indexOf('Key') + 1;
    const valueColumn = headers.indexOf('Value') + 1;
    if (!keyColumn || !valueColumn) throw new Error('Missing Key or Value column in the Tags table');
    return [...root.querySelectorAll(selectors.rows)].map((row, index) => {
      const cell = (column: number) => {
        const selector = selectors.cell.replace('987654', String(index + 1)).replace('123456', String(column));
        const found = row.querySelector(selector);
        if (!found) throw new Error('Missing tag cell for column ' + headers[column - 1]);
        return found;
      };
      const key = cell(keyColumn).cloneNode(true) as HTMLElement;
      key.querySelectorAll('button').forEach(button => button.remove());
      return { Key: key.textContent?.trim() ?? '', Value: cell(valueColumn).textContent?.trim() ?? '' };
    });
  }, selectors);
}
