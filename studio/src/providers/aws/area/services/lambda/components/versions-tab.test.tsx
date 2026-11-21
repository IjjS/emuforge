import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { functionTabHref } from '../format';
import { FunctionPage } from '../pages/function-page';
import { LIST_ALIASES, LIST_VERSIONS, type ReleaseChange } from '../version-api';

type MutationOperation = ReleaseChange['operation'];
type Operation =
  'GetFunction' | 'GetFunctionUrlConfig' | typeof LIST_VERSIONS | typeof LIST_ALIASES | MutationOperation;

const paths: Record<string, Operation> = {
  'GET ': 'GetFunction',
  'GET /url': 'GetFunctionUrlConfig',
  'GET /versions': LIST_VERSIONS,
  'GET /aliases': LIST_ALIASES,
  'POST /versions': 'PublishVersion',
  'POST /aliases': 'CreateAlias',
  'PUT /aliases/live': 'UpdateAlias',
  'DELETE /aliases/live': 'DeleteAlias',
};

function json(body: unknown, status = 200, code?: string) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(code === undefined ? {} : { 'x-amzn-errortype': code }) },
  });
}

function versionAnswer(numbers: string[], marker?: string) {
  return json({
    Versions: numbers.map((Version) => ({ Version, Description: `Source ${Version}` })),
    NextMarker: marker,
  });
}

function aliasAnswer(aliases: Record<string, string>, marker?: string) {
  return json({
    Aliases: Object.entries(aliases).map(([Name, FunctionVersion]) => ({ Name, FunctionVersion })),
    NextMarker: marker,
  });
}

function functionAnswer(Description = 'Initial function details') {
  return json({
    Configuration: { FunctionName: 'orders', State: 'Active', LastUpdateStatus: 'Successful', Description },
  });
}

class ReleaseEngine {
  versions = ['$LATEST', '1', '2'];
  aliases: Record<string, string> = { live: '1' };
  readonly calls: { operation: Operation; marker: string | null; body: unknown }[] = [];
  handlers: Partial<Record<Operation, (marker: string | null) => Response | Promise<Response>>> = {};

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return json({ token: 'emuforge-test-token' });
    }
    const suffix = /^\/\d{4}-\d{2}-\d{2}\/functions\/orders(.*)$/.exec(url.pathname)?.[1];
    const operation = paths[`${request.method} ${suffix ?? '?'}`];
    if (operation === undefined) {
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
    }
    const marker = url.searchParams.get('Marker');
    const body: unknown = request.body === null ? undefined : await request.json();
    this.calls.push({ operation, marker, body });
    const handler = this.handlers[operation];
    if (handler !== undefined) {
      return handler(marker);
    }
    switch (operation) {
      case 'GetFunction':
        return functionAnswer();
      case 'GetFunctionUrlConfig':
        return json({ message: 'No URL' }, 404, 'ResourceNotFoundException');
      case LIST_VERSIONS:
        return versionAnswer(this.versions);
      case LIST_ALIASES:
        return aliasAnswer(this.aliases);
      default:
        throw new Error(`No reply was prepared for ${operation}`);
    }
  };

  count(operation: Operation): number {
    return this.calls.filter((call) => call.operation === operation).length;
  }
}

let engine: ReleaseEngine;
let enginePort = 9440;

beforeEach(() => {
  engine = new ReleaseEngine();
  enginePort += 1;
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => vi.unstubAllGlobals());

function renderTab() {
  const root = { current: null as HTMLDivElement | null };
  const connected = {
    kind: 'connected' as const,
    checkedAt: 0,
    emulator: { port: 9305, endpoint: 'https://127.0.0.1:9305' },
  };
  const connection: AreaConnection = { engineOrigin: `http://127.0.0.1:${enginePort}`, result: connected };

  function ReleasePage({ connection }: { connection: AreaConnection }) {
    const [flash, show] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ show, handOver: () => undefined }}>
          <div
            ref={(element) => {
              root.current = element;
            }}
          >
            {flash !== undefined && <Flashbar items={[...flash]} />}
            <FunctionPage connection={connection} params={{ name: 'orders' }} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }

  const client = new QueryClient();
  function app(connection: AreaConnection) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[functionTabHref('orders', 'versions')]}>
          <ReleasePage connection={connection} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const { rerender, unmount } = render(app(connection));
  return {
    client,
    unmount,
    replaceHealth: () => {
      rerender(app({ ...connection, result: { ...connected, checkedAt: Date.now() + 1 } }));
    },
  };
}

const PAGE = createWrapper(document.body);
function expectPageFlash(type: 'error' | 'info' | 'success', content: string, header?: string) {
  const flashbar = PAGE.findFlashbar();
  expect(flashbar?.findItems()).toHaveLength(1);
  const flash = flashbar?.findItemsByType(type)[0];
  if (header !== undefined) {
    expect(flash?.findHeader()?.getElement()).toHaveTextContent(header);
  }
  expect(flash?.findContent()?.getElement()).toHaveTextContent(content);
}

function expectNoPageFlash() {
  expect(PAGE.findFlashbar()?.findItems() ?? []).toHaveLength(0);
}

function expectInlineRefusal(dialog: ReturnType<typeof manageDialog>, operation: MutationOperation, message: string) {
  const alerts = dialog.findContent().findAllAlerts();
  expect(alerts).toHaveLength(1);
  const [alert] = alerts;
  expect(alert?.findHeader()?.getElement()).toHaveTextContent(`${operation} failed`);
  expect(alert?.findContent().getElement()).toHaveTextContent(`ResourceConflictException: ${message}`);
  expect(alert?.getElement()).toBeVisible();
  return alert;
}

type TableName = 'Versions' | 'Aliases';

function releaseTable(name: TableName) {
  const table = PAGE.findAllTables()[name === 'Versions' ? 0 : 1];
  if (table !== undefined) {
    expect(table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent(name);
  }
  return table;
}

function releaseRows(name: TableName, columnCount: number) {
  const table = releaseTable(name);
  return (
    table?.findRows().map((_, index) =>
      Array.from({ length: columnCount }, (_, column) =>
        table
          .findBodyCell(index + 1, column + 1)
          ?.getElement()
          .textContent?.trim(),
      ),
    ) ?? []
  );
}

function aliasIndex(name: string) {
  return releaseRows('Aliases', 2).findIndex(([, label]) => label === name) + 1;
}

function aliasMenu(row: number) {
  const menu = releaseTable('Aliases')?.findBodyCell(row, 1)?.findButtonDropdown();
  if (menu == null) throw new Error('Expected an alias action menu');
  return menu;
}

function openAliasMenu(row: number) {
  const menu = aliasMenu(row);
  if (menu.findNativeButton().getElement().getAttribute('aria-expanded') !== 'true') {
    menu.openDropdown();
  }
  return menu;
}

function menuAction(row: number, operation: 'UpdateAlias' | 'DeleteAlias') {
  const item = openAliasMenu(row).findItemById(operation)?.find('[role="menuitem"]')?.getElement();
  if (item === undefined) throw new Error(`Expected the ${operation} menu action`);
  return item;
}

function releaseAction(operation: MutationOperation) {
  if (operation === 'PublishVersion' || operation === 'CreateAlias') {
    const table = releaseTable(operation === 'PublishVersion' ? 'Versions' : 'Aliases');
    const button = table?.findHeaderSlot()?.findHeader()?.findActions()?.findButton()?.getElement();
    if (button === undefined) throw new Error(`Expected the ${operation} button`);
    expect(button).toHaveAccessibleName(operation === 'PublishVersion' ? 'Publish version' : 'Create alias');
    return button;
  }
  return menuAction(aliasIndex('live'), operation);
}

function manageDialog() {
  const dialog = PAGE.findModal();
  if (dialog === null) throw new Error('Expected an alias dialog');
  return dialog;
}

function aliasNameField(dialog = manageDialog()) {
  const field = dialog.findContent().findAllFormFields()[0];
  if (field === undefined) throw new Error('Expected the alias name field');
  expect(field.findLabel()?.getElement()).toHaveTextContent('Alias name');
  return field;
}

function aliasNameInput(dialog = manageDialog()) {
  const input = aliasNameField(dialog).findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error('Expected the alias name input');
  expect(input).toHaveAccessibleName('Alias name');
  return input;
}

function targetSelect(dialog = manageDialog()) {
  const field = dialog.findContent().findAllFormFields()[1];
  const select = field?.findControl()?.findSelect();
  if (select == null) throw new Error('Expected a target version selector');
  expect(field?.findLabel()?.getElement()).toHaveTextContent('Target version');
  return select;
}

function dialogButton(action: 'cancel' | 'submit', label: string) {
  const button = manageDialog().findFooter()?.findAllButtons()[action === 'cancel' ? 0 : 1]?.getElement();
  if (button === undefined) throw new Error(`Expected the ${action} dialog button`);
  expect(button).toHaveAccessibleName(label);
  return button;
}

async function prepareAction(operation: MutationOperation, aliasName = 'next') {
  if (operation === 'PublishVersion') {
    return releaseAction(operation);
  }
  fireEvent.click(releaseAction(operation));
  const dialog = await waitFor(manageDialog);
  if (operation === 'CreateAlias') {
    fireEvent.change(aliasNameInput(dialog), { target: { value: aliasName } });
  }
  if (operation === 'CreateAlias' || operation === 'UpdateAlias') {
    const select = targetSelect(dialog);
    select.openDropdown();
    select.selectOptionByValue('2');
  }
  return dialogButton(
    'submit',
    operation === 'CreateAlias' ? 'Create alias' : operation === 'UpdateAlias' ? 'Save changes' : 'Delete alias',
  );
}

function holdResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(response: ReturnType<typeof holdResponse>, value: Response) {
  await act(async () => {
    response.resolve(value);
    await response.promise;
  });
}

function succeed(operation: MutationOperation): Response {
  switch (operation) {
    case 'PublishVersion':
      engine.versions.push('3');
      return json({ Version: '3' }, 201);
    case 'CreateAlias':
      engine.aliases.next = '2';
      return json({ Name: 'next', FunctionVersion: '2' }, 201);
    case 'UpdateAlias':
      engine.aliases.live = '2';
      return json({ Name: 'live', FunctionVersion: '2' });
    case 'DeleteAlias':
      engine.aliases = {};
      return json(undefined, 204);
  }
}

const actions = [
  ['PublishVersion', 'Published version 3.'],
  ['CreateAlias', 'Created alias next to version 2.'],
  ['UpdateAlias', 'Updated alias live to version 2.'],
  ['DeleteAlias', 'Deleted alias live.'],
] as const;

async function waitForBothLists() {
  await waitFor(() => {
    expect(releaseRows('Versions', 3)).toContainEqual(['2', 'Published', 'Source 2']);
    expectAlias('live', '1');
  });
}

function expectAlias(name: string, version: string) {
  const row = aliasIndex(name);
  expect(row).toBeGreaterThan(0);
  expect(releaseTable('Aliases')?.findBodyCell(row, 3)?.getElement().textContent).toBe(version);
}

describe('Release listings', () => {
  it('follows both markers and excludes the editable $LATEST from alias targets', async () => {
    engine.handlers[LIST_VERSIONS] = (marker) =>
      marker === null ? versionAnswer(['$LATEST', '1'], 'more-versions') : versionAnswer(['2']);
    engine.handlers[LIST_ALIASES] = (marker) =>
      marker === null ? aliasAnswer({ live: '1' }, 'more-aliases') : aliasAnswer({ candidate: '2' });
    renderTab();
    await waitFor(() => {
      expect(releaseRows('Versions', 3)).toEqual([
        ['$LATEST', 'Editable', 'Source $LATEST'],
        ['1', 'Published', 'Source 1'],
        ['2', 'Published', 'Source 2'],
      ]);
      expectAlias('candidate', '2');
    });
    expectAlias('live', '1');
    expectAlias('candidate', '2');
    expect(engine.calls.filter(({ operation }) => operation === LIST_VERSIONS).map(({ marker }) => marker)).toEqual([
      null,
      'more-versions',
    ]);
    expect(engine.calls.filter(({ operation }) => operation === LIST_ALIASES).map(({ marker }) => marker)).toEqual([
      null,
      'more-aliases',
    ]);

    fireEvent.click(releaseAction('CreateAlias'));
    const select = targetSelect(await waitFor(manageDialog));
    select.openDropdown();
    const options = select.findDropdown();
    expect(options.findOptions()).toHaveLength(2);
    expect(options.findOptionByValue('1')?.findLabel().getElement()).toHaveTextContent('1');
    expect(options.findOptionByValue('2')?.findLabel().getElement()).toHaveTextContent('2');
    expect(options.findOptionByValue('$LATEST')).toBeNull();
  });

  it('explains the requirement to publish a version before creating an alias', async () => {
    engine.versions = ['$LATEST'];
    engine.aliases = {};
    renderTab();
    await waitFor(() => expect(releaseRows('Versions', 1)).toEqual([['$LATEST']]));
    expect(releaseTable('Aliases')?.findHeaderSlot()?.findHeader()?.findDescription()?.getElement()).toHaveTextContent(
      'Publish a version before creating an alias.',
    );
    expect(releaseAction('CreateAlias')).toHaveAttribute('aria-disabled', 'true');
  });

  it.each([
    [LIST_VERSIONS, 403, 'AccessDeniedException'],
    [LIST_VERSIONS, 501, 'Not implemented by the emulator'],
    [LIST_ALIASES, 403, 'PolicyRefused'],
    [LIST_ALIASES, 501, 'Not implemented by the emulator'],
  ] as const)('%s can fail with %s without hiding the other listing', async (operation, status, message) => {
    engine.handlers[operation] = () => json({ message: 'Operation unavailable' }, status, message);
    renderTab();
    const failed = operation === LIST_VERSIONS ? 'Versions' : 'Aliases';
    await waitFor(() => {
      if (operation === LIST_VERSIONS) {
        expectAlias('live', '1');
      } else {
        expect(releaseRows('Versions', 3)).toContainEqual(['2', 'Published', 'Source 2']);
      }
      const state = releaseTable(failed)?.findEmptySlot()?.getElement();
      expect(state).toHaveTextContent(message);
      expect(state).toHaveTextContent(operation);
    });
  });
});

describe('Release actions', () => {
  it('names the alias in the deletion confirmation and leaves it alone on Cancel', async () => {
    renderTab();
    await waitForBothLists();
    await prepareAction('DeleteAlias');
    expect(manageDialog().findContent().getElement()).toHaveTextContent('Delete alias live?');
    fireEvent.click(dialogButton('cancel', 'Cancel'));
    expect(PAGE.findModal()).toBeNull();
    expectAlias('live', '1');
    expect(engine.count('DeleteAlias')).toBe(0);
  });

  it('cancels a paused alias deletion at native disconnect before it can reach a same-name replacement', async () => {
    const wasOnline = onlineManager.isOnline();
    const browserOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { client, unmount, replaceHealth } = renderTab();
    try {
      await waitForBothLists();
      const confirm = await prepareAction('DeleteAlias');
      act(() => onlineManager.setOnline(false));
      fireEvent.click(confirm);
      const [queued] = client.getMutationCache().getAll();
      await waitFor(() => expect(queued?.state.isPaused).toBe(true));
      expect(engine.count('DeleteAlias')).toBe(0);

      browserOnline.mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event('offline'));
        const submission = queued?.state.variables as { signal: AbortSignal } | undefined;
        expect(submission?.signal.aborted).toBe(true);
      });
      expect(PAGE.findModal()).toBeNull();

      engine.aliases = { live: '2' };
      engine.handlers.DeleteAlias = () => succeed('DeleteAlias');
      const detail = holdResponse();
      engine.handlers.GetFunction = async () => (await detail.promise).clone();
      browserOnline.mockReturnValue(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await client.resumePausedMutations();
      });
      expect(queued?.state.error).toMatchObject({ name: 'AbortError' });
      expect(engine.count('DeleteAlias')).toBe(0);
      expectNoPageFlash();

      const reads = engine.count('GetFunction');
      replaceHealth();
      await waitFor(() => expect(engine.count('GetFunction')).toBeGreaterThan(reads));
      expect(engine.count('DeleteAlias')).toBe(0);
      await settle(detail, functionAnswer('Replacement function details'));
      await waitFor(() => expectAlias('live', '2'));
      engine.handlers.GetFunction = () => functionAnswer('Replacement function details');
      expect(engine.count('DeleteAlias')).toBe(0);
      expectNoPageFlash();

      fireEvent.click(await prepareAction('DeleteAlias'));
      await waitFor(() => expectPageFlash('success', 'Deleted alias live.'));
      expect(engine.count('DeleteAlias')).toBe(1);
    } finally {
      unmount();
      browserOnline.mockRestore();
      onlineManager.setOnline(wasOnline);
    }
  });

  it.each(actions)('%s submits once while pending and identifies its success', async (operation, message) => {
    const response = holdResponse();
    engine.handlers[operation] = () => response.promise;
    renderTab();
    await waitForBothLists();
    const submit = await prepareAction(operation);
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await waitFor(() => expect(engine.count(operation)).toBe(1));
    await settle(response, succeed(operation));
    await waitFor(() => expectPageFlash('success', message));
    expect(engine.count(operation)).toBe(1);
    const call = engine.calls.find((entry) => entry.operation === operation);
    if (operation === 'CreateAlias') {
      expect(call?.body).toMatchObject({ Name: 'next', FunctionVersion: '2' });
    } else if (operation === 'UpdateAlias') {
      expect(call?.body).toMatchObject({ FunctionVersion: '2' });
    }
  });

  it.each(actions)('%s shows the refusal and leaves the listings intact', async (operation) => {
    engine.handlers[operation] = () =>
      json({ message: 'The emulator refused the change' }, 409, 'ResourceConflictException');
    renderTab();
    await waitForBothLists();
    const submit = await prepareAction(operation, 'live');
    submit.focus();
    fireEvent.click(submit);

    if (operation !== 'PublishVersion') {
      const dialog = manageDialog();
      const alert = await waitFor(() => expectInlineRefusal(dialog, operation, 'The emulator refused the change'));
      expectNoPageFlash();
      expect(alert?.getElement()).toContainElement(document.activeElement as HTMLElement);
      if (operation === 'CreateAlias') {
        expect(aliasNameInput(dialog)).toHaveValue('live');
      } else {
        expect(dialog.findContent().getElement()).toHaveTextContent('live');
      }
      if (operation === 'CreateAlias' || operation === 'UpdateAlias') {
        expect(targetSelect(dialog).findTrigger().getElement()).toHaveTextContent('2');
      }
      fireEvent.click(dialogButton('cancel', 'Cancel'));
      expect(PAGE.findModal()).toBeNull();
    }

    await waitFor(() =>
      expectPageFlash('error', 'ResourceConflictException: The emulator refused the change', `${operation} failed`),
    );
    expect(aliasIndex('next')).toBe(0);
    expect(releaseRows('Versions', 3)).not.toContainEqual(['3', 'Published', 'Source 3']);
    expectAlias('live', '1');
  });

  it('clears the single announced refusal when correcting the alias draft', async () => {
    engine.handlers.CreateAlias = () => json({ message: 'Alias exists' }, 409, 'ResourceConflictException');
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction('CreateAlias', 'live'));
    const dialog = manageDialog();
    await waitFor(() => expectInlineRefusal(dialog, 'CreateAlias', 'Alias exists'));
    expectNoPageFlash();
    fireEvent.change(aliasNameInput(dialog), { target: { value: 'next' } });
    expect(dialog.findContent().findAllAlerts()).toHaveLength(0);
    expectNoPageFlash();

    engine.handlers.CreateAlias = () => succeed('CreateAlias');
    fireEvent.click(dialogButton('submit', 'Create alias'));
    await waitFor(() => expectPageFlash('success', 'Created alias next to version 2.'));
    await waitFor(() => expectAlias('next', '2'));
  });

  it('reports a refusal on the page when the tab closes the submitting dialog', async () => {
    const response = holdResponse();
    engine.handlers.CreateAlias = () => response.promise;
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction('CreateAlias', 'live'));
    await waitFor(() => expect(engine.count('CreateAlias')).toBe(1));
    const test = PAGE.findTabs()?.findTabLinkById('test');
    expect(test?.getElement()).toBeVisible();
    test?.click();
    expect(PAGE.findModal()).toBeNull();
    expectNoPageFlash();
    await settle(response, json({ message: 'Alias exists' }, 409, 'ResourceConflictException'));
    await waitFor(() => expectPageFlash('error', 'ResourceConflictException: Alias exists', 'CreateAlias failed'));
  });

  it('places both alias actions behind the labeled leading control beside the full name', async () => {
    const name = 'candidate-release-stable';
    engine.aliases = { [name]: '1' };
    renderTab();
    await waitFor(() => expectAlias(name, '1'));
    expect(aliasMenu(1).findNativeButton().getElement()).toHaveAccessibleName(`Actions for alias ${name}`);
    expect(releaseTable('Aliases')?.findBodyCell(1, 2)?.getElement()).toHaveTextContent(name);
    expect(menuAction(1, 'UpdateAlias')).toHaveAccessibleName(`Edit alias ${name}`);
    expect(menuAction(1, 'DeleteAlias')).toHaveAccessibleName(`Delete alias ${name}`);
  });

  it('keeps the action focused while moving the labeled target beneath the alias on narrow screens', async () => {
    const name = 'release-candidate-012345';
    const target = '1234567890';
    const media = new EventTarget();
    let narrow = false;
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return narrow && query === '(width < 688px)';
      },
      addEventListener: media.addEventListener.bind(media),
      removeEventListener: media.removeEventListener.bind(media),
    }));
    engine.aliases = { [name]: target };
    renderTab();
    await waitFor(() => expectAlias(name, target));
    expect(releaseTable('Aliases')?.findColumnHeaders()[2]?.getElement()).toHaveTextContent('Target version');
    const trigger = aliasMenu(1).findNativeButton().getElement();
    trigger.focus();

    act(() => {
      narrow = true;
      media.dispatchEvent(new Event('change'));
    });

    const table = releaseTable('Aliases');
    expect(table?.findBodyCell(1, 2)?.getElement()).toHaveTextContent(`${name}Target version ${target}`);
    expect(table?.findColumnHeaders()).toHaveLength(2);
    expect(table?.findBodyCell(1, 3)).toBeNull();
    expect(aliasMenu(1).findNativeButton().getElement()).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(menuAction(1, 'UpdateAlias')).toHaveAccessibleName(`Edit alias ${name}`);
    expect(menuAction(1, 'DeleteAlias')).toHaveAccessibleName(`Delete alias ${name}`);
  });

  it('describes the alias name constraints before submission and rejects a numeric name', async () => {
    renderTab();
    await waitForBothLists();
    const submit = await prepareAction('CreateAlias', '123');
    const name = aliasNameInput();
    const field = aliasNameField();
    const constraints = /Use 1–128 letters.*numbers, hyphens, or underscores.*cannot be all numbers/;
    expect(field.findConstraint()?.getElement()).toHaveTextContent(constraints);
    expect(name).toHaveAccessibleDescription(constraints);
    fireEvent.click(submit);
    expect(field.findError()?.getElement()).toHaveTextContent(
      'Enter 1–128 letters, numbers, hyphens, or underscores. The name cannot be all numbers.',
    );
    expect(engine.count('CreateAlias')).toBe(0);
  });

  it.each(actions)('%s stays visible but unavailable after a 501', async (operation) => {
    engine.handlers[operation] = () => json({ message: 'Unsupported' }, 501, 'NotImplementedException');
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction(operation));
    await waitFor(() =>
      expectPageFlash(
        'info',
        `The emulator answered 501 Not Implemented for ${operation}.`,
        'Not implemented by the emulator',
      ),
    );
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    const unsupported = releaseAction(operation);
    expect(unsupported).toBeVisible();
    expect(unsupported).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(unsupported);
    expect(engine.count(operation)).toBe(1);
    expect(PAGE.findModal()).toBeNull();
    for (const [other] of actions.filter(([other]) => other !== operation)) {
      expect(releaseAction(other)).not.toHaveAttribute('aria-disabled', 'true');
      expect(releaseAction(other)).not.toBeDisabled();
    }
  });

  it.each(
    actions
      .slice(1)
      .flatMap(([operation, message]) => ['aliases', 'detail'].map((first) => ({ operation, message, first }))),
  )('$operation shows the current mapping with $first settling first', async ({ operation, message, first }) => {
    const detail = holdResponse();
    const aliases = holdResponse();
    let changed = false;
    engine.handlers.GetFunction = () => (changed ? detail.promise : functionAnswer());
    engine.handlers[LIST_ALIASES] = () => (changed ? aliases.promise : aliasAnswer(engine.aliases));
    engine.handlers[operation] = () => {
      changed = true;
      return succeed(operation);
    };
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction(operation));
    await waitFor(() => expectPageFlash('success', message));
    await waitFor(() => {
      expect(engine.count('GetFunction')).toBe(2);
      expect(engine.count(LIST_ALIASES)).toBe(2);
    });

    const expectCurrentAliases = async () => {
      if (operation === 'DeleteAlias') {
        await waitFor(() =>
          expect(releaseTable('Aliases')?.findEmptySlot()?.getElement()).toHaveTextContent('No aliases'),
        );
        expect(releaseRows('Aliases', 3)).toEqual([]);
      } else {
        const name = operation === 'CreateAlias' ? 'next' : 'live';
        await waitFor(() => expectAlias(name, '2'));
      }
    };
    const refreshedDescription = 'Updated function details after the alias changed';
    function description() {
      const pair = PAGE.findKeyValuePairs()?.findItems()[0];
      expect(pair?.findLabel()?.getElement()).toHaveTextContent('Description');
      return pair?.findValue()?.getElement();
    }
    async function settleDetail() {
      await settle(detail, functionAnswer(refreshedDescription));
      await waitFor(() => expect(description()).toHaveTextContent(refreshedDescription));
    }

    expect(description()).toHaveTextContent('Initial function details');
    if (first === 'aliases') {
      await settle(aliases, aliasAnswer(engine.aliases));
      await expectCurrentAliases();
      expectPageFlash('success', message);
      await settleDetail();
    } else {
      await settleDetail();
      expectPageFlash('success', message);
      await settle(aliases, aliasAnswer(engine.aliases));
    }
    await expectCurrentAliases();
    expect(description()).toHaveTextContent(refreshedDescription);
    expect(releaseRows('Versions', 3)).toContainEqual(['2', 'Published', 'Source 2']);
    expectPageFlash('success', message);
  });
});
