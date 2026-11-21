import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function functionAnswer() {
  return json({ Configuration: { FunctionName: 'orders', State: 'Active', LastUpdateStatus: 'Successful' } });
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
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${enginePort}`,
    result: {
      kind: 'connected',
      checkedAt: 0,
      emulator: { port: 9305, endpoint: 'https://127.0.0.1:9305' },
    },
  };

  function ReleasePage() {
    const [flash, show] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ show, handOver: () => undefined }}>
          <div
            ref={(element) => {
              root.current = element;
            }}
          >
            {flash?.map(({ header, content }, index) => (
              <div key={index} role="status">
                {header}
                <div>{content}</div>
              </div>
            ))}
            <FunctionPage connection={connection} params={{ name: 'orders' }} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[functionTabHref('orders', 'versions')]}>
        <ReleasePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function versionsTable() {
  return within(screen.getByRole('table', { name: 'Versions' }));
}

function aliasesTable() {
  return within(screen.getByRole('table', { name: 'Aliases' }));
}

function aliasActions(name: string) {
  return screen.getByRole('button', { name: `Actions for alias ${name}` });
}

function releaseAction(operation: MutationOperation) {
  if (operation === 'PublishVersion' || operation === 'CreateAlias') {
    return screen.getByRole('button', { name: operation === 'PublishVersion' ? 'Publish version' : 'Create alias' });
  }
  const trigger = aliasActions('live');
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(trigger);
  }
  return screen.getByRole('menuitem', { name: operation === 'UpdateAlias' ? 'Edit alias live' : 'Delete alias live' });
}

function openTargetSelect(dialog: HTMLElement) {
  const select = createWrapper(dialog).findSelect();
  if (select === null) {
    throw new Error('Expected a target version selector');
  }
  select.openDropdown();
  return select;
}

async function prepareAction(operation: MutationOperation, aliasName = 'next') {
  if (operation === 'PublishVersion') {
    return releaseAction(operation);
  }
  fireEvent.click(releaseAction(operation));
  const dialog = await screen.findByRole('dialog');
  if (operation === 'CreateAlias') {
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Alias name' }), { target: { value: aliasName } });
  }
  if (operation === 'CreateAlias' || operation === 'UpdateAlias') {
    const select = openTargetSelect(dialog);
    select.selectOptionByValue('2');
  }
  return within(dialog).getByRole('button', {
    name: operation === 'CreateAlias' ? 'Create alias' : operation === 'UpdateAlias' ? 'Save changes' : 'Delete alias',
  });
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
  expect(await screen.findByText('Source 2')).toBeVisible();
  expect(await screen.findByText('live')).toBeVisible();
}

function expectAlias(name: string, version: string) {
  const row = aliasesTable().getByText(name).closest('tr');
  expect(row).toHaveTextContent(version);
}

describe('Release listings', () => {
  it('follows both markers and excludes the editable $LATEST from alias targets', async () => {
    engine.handlers[LIST_VERSIONS] = (marker) =>
      marker === null ? versionAnswer(['$LATEST', '1'], 'more-versions') : versionAnswer(['2']);
    engine.handlers[LIST_ALIASES] = (marker) =>
      marker === null ? aliasAnswer({ live: '1' }, 'more-aliases') : aliasAnswer({ candidate: '2' });
    renderTab();
    expect(await screen.findByText('Source 2')).toBeVisible();
    expect(await screen.findByText('candidate')).toBeVisible();
    const latest = versionsTable().getByRole('row', { name: /\$LATEST Editable/ });
    expect(latest).toBeVisible();
    expect(versionsTable().getByRole('row', { name: /1 Published Source 1/ })).toBeVisible();
    expect(versionsTable().getByRole('row', { name: /2 Published Source 2/ })).toBeVisible();
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
    expect(
      openTargetSelect(await screen.findByRole('dialog'))
        .findDropdown()
        .findOptions()
        .map((item) => item.findLabel().getElement().textContent),
    ).toEqual(['1', '2']);
  });

  it('explains the requirement to publish a version before creating an alias', async () => {
    engine.versions = ['$LATEST'];
    engine.aliases = {};
    renderTab();
    expect(await screen.findByText('$LATEST')).toBeVisible();
    expect(
      screen
        .getAllByText('Publish a version before creating an alias.')
        .some((node) => node.closest('[hidden]') === null),
    ).toBe(true);
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
    const other = operation === LIST_VERSIONS ? 'live' : 'Source 2';
    expect(await screen.findByText(other)).toBeVisible();
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByText(new RegExp(operation))).toBeVisible();
  });
});

describe('Release actions', () => {
  it('names the alias in the deletion confirmation and leaves it alone on Cancel', async () => {
    renderTab();
    await waitForBothLists();
    await prepareAction('DeleteAlias');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('live')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expectAlias('live', '1');
    expect(engine.count('DeleteAlias')).toBe(0);
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
    expect(await screen.findByText(message)).toBeVisible();
    expect(engine.count(operation)).toBe(1);
    const call = engine.calls.find((entry) => entry.operation === operation);
    if (operation === 'CreateAlias') {
      expect(call?.body).toMatchObject({ Name: 'next', FunctionVersion: '2' });
    } else if (operation === 'UpdateAlias') {
      expect(call?.body).toMatchObject({ FunctionVersion: '2' });
    }
  });

  it.each(actions)('%s shows the refusal and leaves the listings intact', async (operation, message) => {
    engine.handlers[operation] = () =>
      json({ message: 'The emulator refused the change' }, 409, 'ResourceConflictException');
    renderTab();
    await waitForBothLists();
    const submit = await prepareAction(operation, 'live');
    submit.focus();
    fireEvent.click(submit);

    if (operation !== 'PublishVersion') {
      const dialog = screen.getByRole('dialog');
      const inline = within(dialog);
      expect(await inline.findByText('ResourceConflictException')).toBeVisible();
      expect(screen.getAllByText('ResourceConflictException')).toHaveLength(1);
      const alert = inline.getByRole('alert');
      expect(within(alert).getByText(`${operation} failed`)).toBeVisible();
      expect(alert).toContainElement(document.activeElement as HTMLElement);
      if (operation === 'CreateAlias') {
        expect(inline.getByRole('textbox', { name: 'Alias name' })).toHaveValue('live');
      } else {
        expect(inline.getByText('live')).toBeVisible();
      }
      if (operation === 'CreateAlias' || operation === 'UpdateAlias') {
        const select = createWrapper(dialog).findSelect();
        expect(select?.findTrigger().getElement()).toHaveTextContent('2');
      }
      fireEvent.click(inline.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }

    expect(await screen.findByText('ResourceConflictException')).toBeVisible();
    expect(screen.getByText(`${operation} failed`)).toBeVisible();
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByText('next')).toBeNull();
    expect(screen.queryByText('Source 3')).toBeNull();
    expectAlias('live', '1');
  });

  it('clears the single announced refusal when correcting the alias draft', async () => {
    engine.handlers.CreateAlias = () => json({ message: 'Alias exists' }, 409, 'ResourceConflictException');
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction('CreateAlias', 'live'));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText('ResourceConflictException')).toBeVisible();
    expect(screen.getAllByText('ResourceConflictException')).toHaveLength(1);
    fireEvent.change(dialog.getByRole('textbox', { name: 'Alias name' }), { target: { value: 'next' } });
    expect(dialog.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('ResourceConflictException')).toBeNull();

    engine.handlers.CreateAlias = () => succeed('CreateAlias');
    fireEvent.click(dialog.getByRole('button', { name: 'Create alias' }));
    expect(await screen.findByText('Created alias next to version 2.')).toBeVisible();
    await waitFor(() => expectAlias('next', '2'));
  });

  it('reports a refusal on the page when the tab closes the submitting dialog', async () => {
    const response = holdResponse();
    engine.handlers.CreateAlias = () => response.promise;
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction('CreateAlias', 'live'));
    await waitFor(() => expect(engine.count('CreateAlias')).toBe(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Test' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await settle(response, json({ message: 'Alias exists' }, 409, 'ResourceConflictException'));
    expect(await screen.findByText('ResourceConflictException')).toBeVisible();
    expect(screen.getByText('CreateAlias failed')).toBeVisible();
  });

  it('places both alias actions behind the labeled leading control beside the full name', async () => {
    const name = 'candidate-release-stable';
    engine.aliases = { [name]: '1' };
    renderTab();
    const rowHeader = await screen.findByRole('rowheader', { name });
    const row = rowHeader.closest('tr');
    expect(row?.cells[0]).toContainElement(aliasActions(name));
    expect(row?.cells[1]).toBe(rowHeader);
    fireEvent.click(aliasActions(name));
    expect(screen.getByRole('menuitem', { name: `Edit alias ${name}` })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: `Delete alias ${name}` })).toBeVisible();
  });

  it('describes the alias name constraints before submission and rejects a numeric name', async () => {
    renderTab();
    await waitForBothLists();
    const submit = await prepareAction('CreateAlias', '123');
    const dialog = within(screen.getByRole('dialog'));
    const name = dialog.getByRole('textbox', { name: 'Alias name' });
    const constraints = /Use 1–128 letters.*numbers, hyphens, or underscores.*cannot be all numbers/;
    expect(dialog.getByText(constraints)).toBeVisible();
    expect(name).toHaveAccessibleDescription(constraints);
    fireEvent.click(submit);
    expect(
      dialog.getByText('Enter 1–128 letters, numbers, hyphens, or underscores. The name cannot be all numbers.'),
    ).toBeVisible();
    expect(engine.count('CreateAlias')).toBe(0);
  });

  it.each(actions)('%s stays visible but unavailable after a 501', async (operation) => {
    engine.handlers[operation] = () => json({ message: 'Unsupported' }, 501, 'NotImplementedException');
    renderTab();
    await waitForBothLists();
    fireEvent.click(await prepareAction(operation));
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(`The emulator answered 501 Not Implemented for ${operation}.`)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const unsupported = releaseAction(operation);
    expect(unsupported).toBeVisible();
    expect(unsupported).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(unsupported);
    expect(engine.count(operation)).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(await screen.findByText(message)).toBeVisible();
    await waitFor(() => {
      expect(engine.count('GetFunction')).toBe(2);
      expect(engine.count(LIST_ALIASES)).toBe(2);
    });

    const expectCurrentAliases = async () => {
      if (operation === 'DeleteAlias') {
        expect(await screen.findByText('No aliases')).toBeVisible();
        expect(aliasesTable().queryByText('live')).toBeNull();
      } else {
        const name = operation === 'CreateAlias' ? 'next' : 'live';
        await waitFor(() => expectAlias(name, '2'));
      }
    };
    if (first === 'aliases') {
      await settle(aliases, aliasAnswer(engine.aliases));
      await expectCurrentAliases();
      expect(screen.getByText(message)).toBeVisible();
      await settle(detail, functionAnswer());
    } else {
      await settle(detail, functionAnswer());
      expect(await screen.findByText('Source 2')).toBeVisible();
      expect(screen.getByText(message)).toBeVisible();
      await settle(aliases, aliasAnswer(engine.aliases));
    }
    await expectCurrentAliases();
    expect(screen.getByText('Source 2')).toBeVisible();
    expect(screen.getByText(message)).toBeVisible();
  });
});
