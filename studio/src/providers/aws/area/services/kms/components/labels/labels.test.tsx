import {
  CreateAliasCommand,
  DescribeKeyCommand,
  ListAliasesCommand,
  ListKeysCommand,
  ListResourceTagsCommand,
  UntagResourceCommand,
  UpdateAliasCommand,
} from '@aws-sdk/client-kms';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { AreaFlash } from '../../../../components/area-flash';
import type { AreaConnection } from '../../../../components/emulator-line';
import { PageFlashContext } from '../../../../components/page-flash';
import { useAreaFlash } from '../../../../components/use-area-flash';
import { KeyPage } from '../../pages/key';
import { Labels } from './labels';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const keyId = 'test-key-1';
const targetId = 'test-key-2';
const alias = 'alias/events';
const page = createWrapper(document.body);
const endpoint = 'http://127.0.0.1:8308';
const connection = {
  engineOrigin: endpoint,
  result: { kind: 'connected', checkedAt: 0, emulator: { endpoint: 'https://127.0.0.1:9308', port: 9308 } },
} as const;
const offlineConnection: AreaConnection = {
  engineOrigin: endpoint,
  result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9308 },
};

interface LabelView {
  currentConnection?: AreaConnection;
  currentKey?: string;
  writesEnabled?: boolean;
  targetGeneration?: number;
}

function open(initial: LabelView = {}) {
  function Area({
    currentConnection = connection,
    currentKey = keyId,
    writesEnabled = true,
    targetGeneration = 0,
  }: LabelView) {
    const root = useRef<HTMLDivElement>(null);
    const flash = useAreaFlash(`/aws/kms/keys/${currentKey}`, 0, true);
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={flash.pageFlash}>
          <div ref={root}>
            {flash.shown && <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />}
            <Labels
              key={targetGeneration}
              connection={currentConnection}
              keyId={currentKey}
              writesEnabled={writesEnabled}
            />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  const client = new QueryClient();
  const tree = (props: LabelView) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Area {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(initial));
  return (next: LabelView) => rerender(tree(next));
}

function aliasPage(name: string, target = keyId) {
  return { Aliases: [{ AliasName: name, TargetKeyId: target }] };
}

function labelsTable(heading: 'Aliases' | 'Tags') {
  const table = page
    .findAllTables()
    .find(
      (candidate) => candidate.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === heading,
    );
  if (!table) throw new Error(`Missing ${heading} table`);
  return table;
}

function labelRow(heading: 'Aliases' | 'Tags', name: string) {
  const table = labelsTable(heading);
  const rows = table.findRows();
  const index = rows.findIndex((_, index) => table.findBodyCell(index + 1, 1)?.getElement().textContent === name);
  const row = rows[index];
  if (!row) throw new Error(`Missing ${name} row in ${heading}`);
  return { element: row.getElement(), cell: (column: number) => table.findBodyCell(index + 1, column)?.getElement() };
}

function expectTag(name: string, value: string, column = 2) {
  const cell = labelRow('Tags', name).cell(column);
  expect(cell).toBeVisible();
  expect(cell?.textContent).toBe(value);
}

function expectEmpty(heading: 'Aliases' | 'Tags', message: string) {
  const empty = labelsTable(heading).findEmptySlot()?.getElement();
  expect(empty).toBeVisible();
  expect(empty?.textContent).toBe(message);
}

function expectFlash(type: 'success' | 'error' | 'info', message: string | RegExp) {
  const content = page.findFlashbar()?.findItemsByType(type)[0]?.findContent()?.getElement();
  expect(content).toBeVisible();
  expect(content).toHaveTextContent(message);
}

async function openTargetPicker() {
  const row = await waitFor(() => labelRow('Aliases', alias));
  fireEvent.click(within(row.element).getByRole('button', { name: `Reassign alias ${alias}` }));
  const modal = await screen.findByRole('dialog', { name: 'Reassign alias' });
  const select = createWrapper(modal).findSelect();
  if (!select) throw new Error('Missing target key Select');
  select.openDropdown();
  return { modal, select };
}

function tagPage(name: string, value: string) {
  return { Tags: [{ TagKey: name, TagValue: value }] };
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function deferred<T>() {
  let resolve!: (answer: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  send.mockReset();
});

describe('key labels', () => {
  it('shows empty alias and tag lists with actions to add each', async () => {
    send.mockResolvedValue({});
    open();

    await waitFor(() => expectEmpty('Aliases', 'No aliases'));
    await waitFor(() => expectEmpty('Tags', 'No tags'));
    clickButton('Create alias');
    const create = within(await screen.findByRole('dialog', { name: 'Create alias' }));
    expect(create.getByRole('textbox', { name: 'Alias name' })).toBeEnabled();
    fireEvent.click(create.getByRole('button', { name: 'Cancel' }));
    clickButton('Add tag');
    const add = within(await screen.findByRole('dialog', { name: 'Add tag' }));
    expect(add.getByRole('textbox', { name: 'Tag name' })).toBeEnabled();
    expect(add.getByRole('textbox', { name: 'Value' })).toBeEnabled();
  });

  it('uses each list’s marker to reach later alias and tag pages for the current key', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListAliasesCommand) {
        expect(command.input.KeyId).toBe(keyId);
        return command.input.Marker === 'next-alias'
          ? aliasPage('alias/invoices')
          : { ...aliasPage(alias), Truncated: true, NextMarker: 'next-alias' };
      }
      if (command instanceof ListResourceTagsCommand) {
        expect(command.input.KeyId).toBe(keyId);
        return command.input.Marker === 'next-tag'
          ? tagPage('owner', 'billing team')
          : { ...tagPage('environment', 'development'), Truncated: true, NextMarker: 'next-tag' };
      }
      throw new Error('Unexpected KMS request');
    });
    open();

    await waitFor(() => expect(labelRow('Aliases', alias).cell(1)).toBeVisible());
    await waitFor(() => expectTag('environment', 'development'));
    const aliasesNext = labelsTable('Aliases').findPagination()?.findNextPageButton().getElement();
    const tagsNext = labelsTable('Tags').findPagination()?.findNextPageButton().getElement();
    if (!aliasesNext || !tagsNext) throw new Error('Missing label pagination');
    fireEvent.click(aliasesNext);
    fireEvent.click(tagsNext);
    await waitFor(() => expect(labelRow('Aliases', 'alias/invoices').cell(1)).toBeVisible());
    await waitFor(() => expectTag('owner', 'billing team'));
  });

  it.each([
    {
      heading: 'Aliases',
      commandType: ListAliasesCommand,
      operation: 'ListAliases',
      failure: new TypeError('Failed to fetch'),
      status: `The EmuForge engine at ${endpoint} is not answering`,
      rowName: alias,
    },
    {
      heading: 'Tags',
      commandType: ListResourceTagsCommand,
      operation: 'ListResourceTags',
      failure: {
        name: 'EmulatorTimeout',
        message: 'The emulator did not answer in time.',
        $fault: 'server',
        $metadata: { httpStatusCode: 504 },
      },
      status: `Not answering at ${connection.result.emulator.endpoint}`,
      rowName: 'environment',
    },
  ] as const)(
    'offers panel-only recovery when $operation fails with a connected frame',
    async ({ heading, commandType, operation, failure, status, rowName }) => {
      let panelFails = true;
      send.mockImplementation(async (command: unknown) => {
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyId: keyId, KeyState: 'Enabled' } };
        if (panelFails && command instanceof commandType) throw failure;
        if (command instanceof ListAliasesCommand) return aliasPage(alias);
        if (command instanceof ListResourceTagsCommand) return tagPage('environment', 'development');
        throw new Error('Unexpected KMS request');
      });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[`/aws/kms/keys/${keyId}`]}>
            <KeyPage connection={connection} params={{ keyid: keyId }} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(await screen.findByRole('heading', { name: 'Key metadata' })).toBeVisible();
      await userEvent.click(screen.getByRole('tab', { name: 'Labels' }));
      const recovery = await waitFor(() => {
        const empty = labelsTable(heading).findEmptySlot();
        const indicator = empty?.findStatusIndicator()?.getElement();
        expect(indicator).toBeVisible();
        expect(indicator).toHaveTextContent(status);
        if (!empty) throw new Error(`Missing ${heading} recovery`);
        return within(empty.getElement());
      });
      expect(recovery.getByText(`The ${heading.toLowerCase()} (${operation}) could not be read.`)).toBeVisible();
      const link = recovery.getByRole('link', { name: 'Connection status' });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', '/');
      const retry = recovery.getByRole('button', { name: 'Retry' });
      expect(retry).toBeVisible();
      const other = heading === 'Aliases' ? 'Tags' : 'Aliases';
      const otherName = heading === 'Aliases' ? 'environment' : alias;
      await waitFor(() => expect(labelRow(other, otherName).cell(1)).toBeVisible());

      panelFails = false;
      fireEvent.click(retry);
      await waitFor(() => expect(labelRow(heading, rowName).cell(1)).toBeVisible());
      if (heading === 'Tags') expectTag('environment', 'development');
      expect(retry).not.toBeInTheDocument();
      expect(send.mock.calls.filter(([command]) => command instanceof commandType)).toHaveLength(2);
      expect(send.mock.calls.filter(([command]) => command instanceof DescribeKeyCommand)).toHaveLength(1);
    },
  );

  it('keeps reassignment success when the original key’s alias read finishes before the target list', async () => {
    let moved = false;
    const targetList = deferred<{ Keys: { KeyId: string }[] }>();
    const keys = { Keys: [{ KeyId: keyId }, { KeyId: targetId }] };
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListKeysCommand) return moved ? targetList.promise : keys;
      if (command instanceof DescribeKeyCommand) {
        return { KeyMetadata: { KeyId: command.input.KeyId, KeyManager: 'CUSTOMER' } };
      }
      if (command instanceof ListAliasesCommand) {
        const owner = moved ? targetId : keyId;
        return command.input.KeyId === owner ? aliasPage(alias, owner) : {};
      }
      if (command instanceof UpdateAliasCommand) {
        expect(command.input).toEqual({ AliasName: alias, TargetKeyId: targetId });
        moved = true;
      }
      return {};
    });
    open();

    const { modal, select } = await openTargetPicker();
    await waitFor(() => expect(select.findDropdown().findOptionByValue(targetId)?.getElement()).toBeVisible());
    select.selectOptionByValue(targetId);
    fireEvent.click(within(modal).getByRole('button', { name: 'Reassign alias' }));

    await waitFor(() => expectEmpty('Aliases', 'No aliases'));
    expectFlash('success', /^Alias reassigned\.$/);
    expect(send.mock.calls.filter(([command]) => command instanceof ListKeysCommand)).toHaveLength(2);
    await act(async () => targetList.resolve(keys));
    expectFlash('success', /^Alias reassigned\.$/);
  });

  it('retains a duplicate alias’s input and refusal without overwriting the existing alias', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListAliasesCommand) return aliasPage(alias);
      if (command instanceof CreateAliasCommand) {
        expect(command.input).toEqual({ AliasName: alias, TargetKeyId: keyId });
        throw {
          name: 'AlreadyExistsException',
          message: 'This alias already exists.',
          $fault: 'client',
          $metadata: { httpStatusCode: 400 },
        };
      }
      return {};
    });
    open();

    await waitFor(() => expect(labelRow('Aliases', alias).cell(1)).toBeVisible());
    clickButton('Create alias');
    const dialog = within(await screen.findByRole('dialog', { name: 'Create alias' }));
    const name = dialog.getByRole('textbox', { name: 'Alias name' });
    fireEvent.change(name, { target: { value: 'events' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create alias' }));

    expect(await dialog.findByText(/This alias already exists/)).toBeVisible();
    expect(name).toHaveValue('events');
    expect(labelRow('Aliases', alias).cell(1)).toBeVisible();
    expect(send.mock.calls.filter(([command]) => command instanceof UpdateAliasCommand)).toHaveLength(0);
  });

  it('keeps the selected tag and shows why KMS refused to remove it', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListResourceTagsCommand) return tagPage('environment', 'development');
      if (command instanceof UntagResourceCommand) {
        expect(command.input).toEqual({ KeyId: keyId, TagKeys: ['environment'] });
        throw {
          name: 'KMSInvalidStateException',
          message: 'This key is pending deletion.',
          $fault: 'client',
          $metadata: { httpStatusCode: 400 },
        };
      }
      return {};
    });
    open();

    const tag = await waitFor(() => labelRow('Tags', 'environment'));
    fireEvent.click(within(tag.element).getByRole('button', { name: 'Remove tag environment' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove tag' }));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'remove' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Remove tag' }));

    await waitFor(() => expectFlash('error', /This key is pending deletion/));
    expectTag('environment', 'development');
  });

  it('keeps submit focused while saving, then focuses the refusal and lets Escape return to the opener', async () => {
    const save = deferred<object>();
    send.mockImplementation(async (command: unknown) => (command instanceof CreateAliasCommand ? save.promise : {}));
    const user = userEvent.setup();
    open();

    await waitFor(() => expectEmpty('Aliases', 'No aliases'));
    const opener = screen.getByRole('button', { name: 'Create alias' });
    await user.click(opener);
    const modal = await screen.findByRole('dialog', { name: 'Create alias' });
    const dialog = within(modal);
    const name = dialog.getByRole('textbox', { name: 'Alias name' });
    expect(name).toHaveAccessibleDescription(/letters, numbers.*alias\/aws\/ is reserved/);
    await user.type(name, 'events');
    const submit = dialog.getByRole('button', { name: 'Create alias' });
    await user.click(submit);

    expect(submit).toHaveFocus();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    fireEvent.keyDown(submit, { key: 'Escape', keyCode: 27 });
    expect(modal).toBeVisible();
    expect(send.mock.calls.filter(([command]) => command instanceof CreateAliasCommand)).toHaveLength(1);

    await act(async () => {
      save.reject({
        name: 'AlreadyExistsException',
        message: 'This alias already exists.',
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
      });
    });
    const refusal = await dialog.findByRole('alert');
    expect(refusal).toHaveFocus();
    expect(name).toHaveValue('events');
    fireEvent.keyDown(refusal, { key: 'Escape', keyCode: 27 });
    expect(modal).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('waits for the page to enable writes and preserves a pending alias through a same-target disconnect', async () => {
    const save = deferred<object>();
    let signal: AbortSignal | undefined;
    send.mockImplementation(async (command: unknown, options: { abortSignal: AbortSignal }) => {
      if (command instanceof CreateAliasCommand) {
        signal = options.abortSignal;
        return save.promise;
      }
      return {};
    });
    const update = open({ writesEnabled: false });

    await waitFor(() => expectEmpty('Aliases', 'No aliases'));
    const create = screen.getByRole('button', { name: 'Create alias' });
    const add = screen.getByRole('button', { name: 'Add tag' });
    expect(create).toBeDisabled();
    expect(add).toBeDisabled();
    fireEvent.click(create);
    expect(screen.queryByRole('dialog', { name: 'Create alias' })).not.toBeInTheDocument();
    expect(send.mock.calls.filter(([command]) => command instanceof CreateAliasCommand)).toHaveLength(0);

    update({ writesEnabled: true });
    fireEvent.click(create);
    const modal = await screen.findByRole('dialog', { name: 'Create alias' });
    const dialog = within(modal);
    fireEvent.change(dialog.getByRole('textbox', { name: 'Alias name' }), { target: { value: 'events' } });
    const submit = dialog.getByRole('button', { name: 'Create alias' });
    fireEvent.click(submit);
    expect(send.mock.calls.filter(([command]) => command instanceof CreateAliasCommand)).toHaveLength(1);
    expect(signal?.aborted).toBe(false);

    update({ currentConnection: offlineConnection });
    expect(modal).toBeVisible();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(signal?.aborted).toBe(false);
    expect(add).toBeDisabled();
    await act(async () => save.resolve({}));
    expect(modal).not.toBeInTheDocument();
    expectFlash('success', /^Alias created\.$/);
    expect(create).toBeDisabled();

    update({});
    expect(create).toBeEnabled();
    expectFlash('success', /^Alias created\.$/);
  });

  it.each([{ currentKey: targetId }, { targetGeneration: 1 }])(
    'preserves a removal 501 across reconnect and clears it on scope change %o',
    async (nextScope) => {
      const remove = deferred<object>();
      send.mockImplementation(async (command: unknown) => {
        if (command instanceof ListResourceTagsCommand) return tagPage('environment', 'development');
        if (command instanceof UntagResourceCommand) return remove.promise;
        return {};
      });
      const update = open();

      const tag = await waitFor(() => labelRow('Tags', 'environment'));
      fireEvent.click(within(tag.element).getByRole('button', { name: 'Remove tag environment' }));
      const modal = await screen.findByRole('dialog', { name: 'Remove tag' });
      const dialog = within(modal);
      const confirmation = dialog.getByRole('textbox');
      fireEvent.change(confirmation, { target: { value: 'remove' } });
      const submit = dialog.getByRole('button', { name: 'Remove tag' });
      update({ currentConnection: offlineConnection });
      expect(submit).toBeDisabled();
      fireEvent.keyDown(confirmation, { key: 'Enter' });
      expect(send.mock.calls.some(([command]) => command instanceof UntagResourceCommand)).toBe(false);

      update({});
      fireEvent.click(submit);
      expect(send.mock.calls.filter(([command]) => command instanceof UntagResourceCommand)).toHaveLength(1);
      update({ currentConnection: offlineConnection });
      expect(modal).toBeVisible();
      await act(async () => {
        remove.reject({ name: 'NotImplemented', $fault: 'server', $metadata: { httpStatusCode: 501 } });
      });
      expect(modal).not.toBeInTheDocument();
      const notice = 'The emulator answered 501 Not Implemented for UntagResource.';
      expectFlash('info', notice);
      const dismiss = page.findFlashbar()?.findItemsByType('info')[0]?.findDismissButton()?.getElement();
      if (!dismiss) throw new Error('Missing notice dismiss control');
      fireEvent.click(dismiss);

      update({});
      expect(screen.getByText(notice)).toBeVisible();
      const current = within(labelRow('Tags', 'environment').element);
      expect(current.getByRole('button', { name: 'Remove tag environment' })).toBeDisabled();
      expect(current.getByRole('button', { name: 'Edit tag environment' })).toBeEnabled();

      update(nextScope);
      const next = await waitFor(() => labelRow('Tags', 'environment'));
      expect(within(next.element).getByRole('button', { name: 'Remove tag environment' })).toBeEnabled();
      expect(screen.queryByText(notice)).not.toBeInTheDocument();
    },
  );

  it.each([
    { visibleWidth: 348, scrollWidth: 404, compact: true, overflows: true },
    { visibleWidth: 348, scrollWidth: 348, compact: true, overflows: false },
    { visibleWidth: 949, scrollWidth: 949, compact: false, overflows: false },
  ])(
    'prioritizes tag actions and reports actual overflow at table width $visibleWidth/$scrollWidth',
    async ({ visibleWidth, scrollWidth, compact, overflows }) => {
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
        return this.querySelector(':scope > table') ? visibleWidth : 0;
      });
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
        return this.querySelector(':scope > table') ? scrollWidth : 0;
      });
      send.mockImplementation(async (command: unknown) =>
        command instanceof ListResourceTagsCommand ? tagPage('environment', 'local development') : {},
      );
      open();

      const row = await waitFor(() => labelRow('Tags', 'environment'));
      const table = screen.getByRole('table', { name: /^Tags/ });
      const wrapper = labelsTable('Tags');
      const hint = 'Scroll sideways to see more of the table.';
      expect(table).toHaveAccessibleName(overflows ? `Tags. ${hint}` : 'Tags');
      const description = wrapper.findHeaderSlot()?.findHeader()?.findDescription()?.getElement();
      if (overflows) {
        expect(description).toBeVisible();
        expect(description?.textContent).toBe(hint);
      } else {
        expect(description ?? null).not.toBeInTheDocument();
      }
      expect(wrapper.findColumnHeaders().map((header) => header.getElement().textContent)).toEqual(
        compact ? ['Tag name', 'Actions', 'Value'] : ['Tag name', 'Value', 'Actions'],
      );
      expectTag('environment', 'local development', compact ? 3 : 2);

      const edit = within(row.element).getByRole('button', { name: 'Edit tag environment' });
      edit.focus();
      await userEvent.keyboard('{Enter}');
      const dialog = within(await screen.findByRole('dialog', { name: 'Edit tag' }));
      expect(dialog.getByRole('textbox', { name: 'Value' })).toHaveValue('local development');
    },
  );

  it('shows aliases on the corresponding reassignment target option', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: keyId }, { KeyId: targetId }] };
      if (command instanceof DescribeKeyCommand) {
        return { KeyMetadata: { KeyId: command.input.KeyId, KeyManager: 'CUSTOMER' } };
      }
      if (command instanceof ListAliasesCommand) {
        return command.input.KeyId === targetId
          ? {
              Aliases: [
                { AliasName: 'alias/billing', TargetKeyId: targetId },
                { AliasName: 'alias/invoices', TargetKeyId: targetId },
              ],
            }
          : aliasPage(alias);
      }
      return {};
    });
    open();

    const { select } = await openTargetPicker();
    const tags = await waitFor(() => {
      const option = select.findDropdown().findOptionByValue(targetId);
      const tags = option?.findTags()?.map((tag) => tag.getElement());
      expect(tags?.map((tag) => tag.textContent)).toEqual(['alias/billing', 'alias/invoices']);
      return tags ?? [];
    });
    for (const tag of tags) expect(tag).toBeVisible();
  });
});
