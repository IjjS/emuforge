import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { deleteEventBus } from '../bus-change-api';
import { getEventBus, listResourceTags, type EventBusRead } from '../bus-api';
import { saveBusTags, updateBusDescription } from '../bus-settings-api';
import { listRules } from '../rule-api';
import { EventBusPage } from './event-bus-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  getEventBus: vi.fn(),
  listResourceTags: vi.fn(),
}));

vi.mock('../rule-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rule-api')>()),
  listRules: vi.fn(),
}));

vi.mock('../bus-change-api', async (original) => ({
  ...(await original<typeof import('../bus-change-api')>()),
  deleteEventBus: vi.fn(),
}));

vi.mock('../bus-settings-api', async (original) => ({
  ...(await original<typeof import('../bus-settings-api')>()),
  saveBusTags: vi.fn(),
  updateBusDescription: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const arn = 'arn:aws:events:us-east-1:123:event-bus/..';
const operation = 'DescribeEventBus';
const read = vi.mocked(getEventBus);
const bus: EventBusRead = { kind: 'found', bus: { Name: '..', Arn: arn } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listResourceTags).mockResolvedValue({});
  vi.mocked(listRules).mockResolvedValue({ items: [] });
  vi.mocked(deleteEventBus).mockResolvedValue(undefined);
  vi.mocked(saveBusTags).mockResolvedValue(undefined);
  vi.mocked(updateBusDescription).mockResolvedValue(undefined);
});

function renderPage(result: AreaConnection['result'] = undefined, segment = '*..') {
  const resources = vi.fn();
  const handOver = vi.fn<PageFlash['handOver']>();
  const show = vi.fn<PageFlash['show']>();
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <PageResourcesContext.Provider value={resources}>
            <PageFlashContext.Provider value={{ show, handOver }}>
              <EventBusPage connection={{ engineOrigin: endpoint, result }} params={{ bus: segment }} />
            </PageFlashContext.Provider>
          </PageResourcesContext.Provider>
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const layout = createWrapper(container).findContentLayout();
  if (!layout) throw new Error('Expected the event bus page');
  return { layout, resources, handOver, show, client, container };
}

it('reads its bus, then the tags by returned ARN and rules by name, and offers links with the bus query', async () => {
  let answer!: (value: EventBusRead) => void;
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const { layout, resources } = renderPage();
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, '..', expect.any(AbortSignal));
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
  expect(resources).toHaveBeenCalledWith({ word: 'rules' });
  expect(layout.findHeader()?.findHeader()?.findHeadingText().getElement().textContent).toBe('..');
  expect(layout.findContent().findStatusIndicator()?.getElement().textContent).toBe('Loading event bus');

  await act(async () => answer(bus));
  await waitFor(() => expect(layout.findContent().findAllTables()).toHaveLength(2));
  expect(listResourceTags).toHaveBeenCalledExactlyOnceWith(endpoint, arn, expect.any(AbortSignal));
  expect(listRules).toHaveBeenCalledExactlyOnceWith(endpoint, '..', '', undefined, expect.any(AbortSignal));
  const header = layout.findHeader();
  const create = header?.findButton('a[href^="/aws/events/rules/create"]')?.getElement();
  expect(create).toHaveAccessibleName('Create rule');
  expect(create).toHaveAttribute('href', '/aws/events/rules/create?bus=..');
  const send = header?.findButton('a[href^="/aws/events/send-events"]')?.getElement();
  expect(send).toHaveAccessibleName('Send events');
  expect(send).toHaveAttribute('href', '/aws/events/send-events?bus=..');
});

it('shows the missing bus and back link without reading tags or rules', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  const { layout } = renderPage();
  const content = layout.findContent();
  await waitFor(() =>
    expect(content.findContainer()?.findContent().getElement()).toHaveTextContent('Event bus not found'),
  );
  const link = content.findLink()?.getElement();
  expect(link).toHaveAccessibleName('Event buses');
  expect(link).toHaveAttribute('href', '/aws/events/event-buses');
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
});

const failures: [RequestFailure, string, string?][] = [
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Denied' }, 'Access denied', 'Denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${endpoint} did not answer`],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Invalid name' },
    'The event bus could not be read',
    'ValidationException: Invalid name',
  ],
];

it.each(failures)('shows a failed DescribeEventBus read and retries (%s)', async (failure, status, detail) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(bus);
  const { layout } = renderPage();
  const content = layout.findContent();
  await waitFor(() => expect(content.findStatusIndicator()?.getElement().textContent).toBe(status));
  if (detail !== undefined) expect(content.findContainer()?.findContent().getElement()).toHaveTextContent(detail);
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
  const retry = content.findButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(content.findAllTables()).toHaveLength(2));
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['not_started', 'connection_failed'] as const)(
  'shows connection recovery and retries when the emulator is %s',
  async (reason) => {
    const emulator = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
    read
      .mockRejectedValueOnce(new RequestError({ kind: 'emulator-did-not-answer', operation, message: '' }))
      .mockResolvedValueOnce(bus);
    const { layout } = renderPage({ kind: 'emulator-unreachable', checkedAt: 0, emulator, reason, message: '' });
    const content = layout.findContent();
    const status = reason === 'not_started' ? 'Not started on port 9313' : `Not answering at ${emulator.endpoint}`;
    await waitFor(() => expect(content.findStatusIndicator()?.getElement().textContent).toBe(status));
    expect(content.findLink()?.getElement()).toHaveAccessibleName('Connection status');
    expect(content.findLink()?.getElement()).toHaveAttribute('href', '/');
    const retry = content.findButton();
    expect(retry?.getElement()).toHaveAccessibleName('Retry');
    retry?.click();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  },
);

const loaded: EventBusRead = {
  kind: 'found',
  bus: { Name: 'orders', Arn: 'arn:orders', Description: 'Routes orders' },
};

async function openDelete() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  return within(await screen.findByRole('dialog', { name: 'Delete event bus orders?' }));
}

function confirmDelete(dialog: ReturnType<typeof within>) {
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'orders' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

function expectDeleteResult(handOver: ReturnType<typeof vi.fn<PageFlash['handOver']>>) {
  expect(handOver).toHaveBeenCalledOnce();
  const [path, result] = handOver.mock.calls[0] ?? [];
  expect(path).toBe('/aws/events/event-buses');
  expect(result?.[0].type).toBe('success');
  expect(render(<>{result?.[0].content}</>).container).toHaveTextContent('Event bus orders deleted.');
}

it('explains why default cannot be deleted', async () => {
  read.mockResolvedValueOnce({ kind: 'found', bus: { Name: 'default' } });
  renderPage(undefined, 'default');
  const action = await screen.findByRole('button', { name: 'Delete' });
  expect(action).toHaveAttribute('aria-disabled', 'true');
  expect(action).toHaveAccessibleDescription('The default event bus cannot be deleted.');
  fireEvent.click(action);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens the delete dialog and hands over the result to Event buses on confirmation', async () => {
  read.mockResolvedValueOnce(loaded);
  const { handOver } = renderPage(undefined, 'orders');
  confirmDelete(await openDelete());
  await waitFor(() => expect(handOver).toHaveBeenCalledOnce());
  expect(deleteEventBus).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  expectDeleteResult(handOver);
});

it.each(['before', 'after'] as const)(
  'keeps the bus and dialog mounted when in-flight reads reject %s the delete answers',
  async (order) => {
    let answerBus!: (answer: EventBusRead) => void;
    let failTags!: (error: RequestError) => void;
    let failRules!: (error: RequestError) => void;
    let answerDelete!: () => void;
    const missing = (operation: string) =>
      new RequestError({
        kind: 'other',
        operation,
        code: 'ResourceNotFoundException',
        message: 'Event bus orders does not exist.',
      });
    read.mockResolvedValueOnce(loaded).mockReturnValueOnce(
      new Promise((resolve) => {
        answerBus = resolve;
      }),
    );
    vi.mocked(listResourceTags)
      .mockResolvedValueOnce({ team: 'core' })
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          failTags = reject;
        }),
      );
    vi.mocked(listRules)
      .mockResolvedValueOnce({ items: [{ Name: 'original-rule' }] })
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          failRules = reject;
        }),
      );
    vi.mocked(deleteEventBus).mockReturnValueOnce(
      new Promise((resolve) => {
        answerDelete = resolve;
      }),
    );
    const { handOver, client, layout } = renderPage(undefined, 'orders');
    await screen.findByText('core');
    await screen.findByRole('link', { name: 'original-rule' });

    const pendingReads = client.refetchQueries({ queryKey: ['events'] });
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
      expect(listRules).toHaveBeenCalledTimes(2);
      expect(listResourceTags).toHaveBeenCalledTimes(2);
    });
    const dialog = await openDelete();
    confirmDelete(dialog);

    async function settleReads() {
      await act(async () => {
        answerBus({ kind: 'not-found' });
        failTags(missing('ListTagsForResource'));
        failRules(missing('ListRules'));
        await pendingReads;
      });
    }

    function expectStablePage() {
      const content = layout.findContent().getElement();
      expect(content).toHaveTextContent('Routes orders');
      expect(content).toHaveTextContent('core');
      expect(content).toHaveTextContent('original-rule');
      expect(content).not.toHaveTextContent('Event bus not found');
      expect(content).not.toHaveTextContent('Event bus orders does not exist.');
      expect(content).not.toHaveTextContent('The rule list could not be read');
      expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
      expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    }

    if (order === 'before') {
      await settleReads();
      expectStablePage();
      expect(handOver).not.toHaveBeenCalled();
    }
    await act(async () => answerDelete());
    if (order === 'after') {
      await settleReads();
      expectStablePage();
    }
    expectDeleteResult(handOver);
    await act(async () => client.refetchQueries({ queryKey: ['events'] }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(listResourceTags).toHaveBeenCalledTimes(2);
    expect(listRules).toHaveBeenCalledTimes(2);
  },
);

it('shows the missing bus when an open delete dialog is dismissed without deleting', async () => {
  let answer!: (value: EventBusRead) => void;
  read.mockResolvedValueOnce(loaded).mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const { client, layout } = renderPage(undefined, 'orders');
  await screen.findByText('Routes orders');
  const pending = client.refetchQueries({ queryKey: ['events', 'bus'] });
  const dialog = await openDelete();
  await act(async () => {
    answer({ kind: 'not-found' });
    await pending;
  });
  expect(layout.findContent().getElement()).not.toHaveTextContent('Event bus not found');
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('link', { name: 'Event buses' })).toBeVisible();
  expect(layout.findContent().findContainer()?.getElement()).toHaveTextContent('Event bus not found');
  expect(deleteEventBus).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Page = ReturnType<typeof renderPage>;

function tagTable({ layout }: Page) {
  return layout
    .findContent()
    .findAllTables()
    .find((table) => table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags');
}

function manageTagsButton(page: Page) {
  return tagTable(page)?.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
}

function descriptionText({ layout }: Page) {
  const pairs = layout.findContent().findContainer()?.findContent().findKeyValuePairs();
  return pairs
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === 'Description')
    ?.findValue()
    ?.getElement().textContent;
}

async function openSettings(page: Page, heading: string) {
  const button = await waitFor(() => {
    const action =
      heading === 'Manage tags'
        ? manageTagsButton(page)
        : page.layout.findContent().findContainer()?.findHeader()?.findHeader()?.findActions()?.findButton();
    expect(action?.getElement()).toHaveAccessibleName(heading);
    expect(action?.getElement()).toBeEnabled();
    return action;
  });
  button?.click();

  return waitFor(() => {
    const modal = createWrapper(page.container).findModal();
    const save = modal
      ?.findFooter()
      ?.findAllButtons()
      .find((action) => action.getElement().textContent === 'Save');
    if (!modal || !save) throw new Error('Expected a settings dialog');
    expect(modal.findHeader().getElement()).toHaveTextContent(heading);
    return { modal, save };
  });
}

async function saveDescription(page: Page) {
  const { modal, save } = await openSettings(page, 'Edit description');
  const input = modal.findContent().findTextarea()?.findNativeTextarea().getElement();
  if (!input) throw new Error('Expected the description field');
  fireEvent.change(input, { target: { value: 'Updated description' } });
  save.click();
}

async function saveTags(page: Page) {
  const { modal, save } = await openSettings(page, 'Manage tags');
  const input = modal
    .findContent()
    .findAttributeEditor()
    ?.findRow(1)
    ?.findField(2)
    ?.findControl()
    ?.findInput()
    ?.findNativeInput()
    .getElement();
  if (!input) throw new Error('Expected the first tag value');
  fireEvent.change(input, { target: { value: 'local' } });
  save.click();
}

function expectSaved(page: Page, text: string) {
  expect(createWrapper(page.container).findModal()).toBeNull();
  expect(page.show).toHaveBeenCalledOnce();
  const result = page.show.mock.calls[0]?.[0][0];
  expect(result?.type).toBe('success');
  expect(render(<>{result?.content}</>).container).toHaveTextContent(text);
}

it('keeps Manage tags disabled until the tags are read', async () => {
  read.mockResolvedValue(loaded);
  const reading = deferred<Record<string, string>>();
  vi.mocked(listResourceTags).mockReturnValueOnce(reading.promise);
  const page = renderPage(undefined, 'orders');
  await waitFor(() => expect(manageTagsButton(page)?.getElement()).toBeDisabled());
  manageTagsButton(page)?.click();
  expect(createWrapper(page.container).findModal()).toBeNull();
  await act(async () => reading.resolve({}));
  await waitFor(() => expect(manageTagsButton(page)?.getElement()).toBeEnabled());
});

it('refreshes the description without restarting the tags and rules reads', async () => {
  const fresh = deferred<EventBusRead>();
  read.mockResolvedValueOnce(loaded).mockReturnValueOnce(fresh.promise);
  const page = renderPage(undefined, 'orders');
  await waitFor(() => expect(manageTagsButton(page)?.getElement()).toBeEnabled());
  await saveDescription(page);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(page.layout.findContent().findAllTables()).toHaveLength(2);
  expect(descriptionText(page)).toBeUndefined();
  expectSaved(page, 'Description of orders saved.');

  await act(async () => fresh.resolve({ kind: 'found', bus: { ...loaded.bus, Description: 'Read after save' } }));
  await waitFor(() => expect(descriptionText(page)).toBe('Read after save'));
  expect(listResourceTags).toHaveBeenCalledOnce();
  expect(listRules).toHaveBeenCalledOnce();
});

it.each([
  ['before', 'old description'],
  ['after', 'old description'],
  ['before', 'failure'],
  ['after', 'failure'],
] as const)(
  'uses the read after a description save when the earlier read settles %s with %s',
  async (order, outcome) => {
    const stale = deferred<EventBusRead>();
    const fresh = deferred<EventBusRead>();
    const updating = deferred<undefined>();
    read.mockResolvedValueOnce(loaded).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    vi.mocked(updateBusDescription).mockReturnValueOnce(updating.promise);
    const page = renderPage(undefined, 'orders');
    await waitFor(() => expect(descriptionText(page)).toBe('Routes orders'));
    const previousRead = page.client.refetchQueries({ queryKey: ['events', 'bus'] });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await saveDescription(page);

    async function settleEarlierRead() {
      await act(async () => {
        if (outcome === 'failure') stale.reject(new Error('Earlier read failed'));
        else stale.resolve(loaded);
        await previousRead;
      });
    }

    if (order === 'before') await settleEarlierRead();
    await act(async () => updating.resolve(undefined));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expectSaved(page, 'Description of orders saved.');
    await act(async () => fresh.resolve({ kind: 'found', bus: { ...loaded.bus, Description: 'Read after save' } }));
    if (order === 'after') await settleEarlierRead();
    await waitFor(() => expect(descriptionText(page)).toBe('Read after save'));
    expect(updateBusDescription).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      'orders',
      'Updated description',
      expect.any(AbortSignal),
    );
  },
);

it.each(['before', 'after'] as const)(
  'uses the read after a tags save when an earlier read answers %s it',
  async (order) => {
    read.mockResolvedValue(loaded);
    const stale = deferred<Record<string, string>>();
    const fresh = deferred<Record<string, string>>();
    vi.mocked(listResourceTags)
      .mockResolvedValueOnce({ team: 'core' })
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const page = renderPage(undefined, 'orders');
    await waitFor(() => expect(manageTagsButton(page)?.getElement()).toBeEnabled());
    const previousRead = page.client.refetchQueries({ queryKey: ['events', 'tags'] });
    await waitFor(() => expect(listResourceTags).toHaveBeenCalledTimes(2));
    await saveTags(page);
    await waitFor(() => expect(listResourceTags).toHaveBeenCalledTimes(3));

    async function settleEarlierRead() {
      await act(async () => {
        stale.resolve({ team: 'core' });
        await previousRead;
      });
    }

    if (order === 'before') await settleEarlierRead();
    await act(async () => fresh.resolve({ team: 'answered' }));
    if (order === 'after') await settleEarlierRead();
    await waitFor(() => expect(tagTable(page)?.findBodyCell(1, 2)?.getElement().textContent).toBe('answered'));
    expectSaved(page, 'Tags of orders saved.');
    expect(saveBusTags).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      'arn:orders',
      { remove: [], put: { team: 'local' } },
      expect.any(AbortSignal),
    );
  },
);

it('keeps the tags success result while the fresh read loads and when it fails', async () => {
  read.mockResolvedValue(loaded);
  const fresh = deferred<Record<string, string>>();
  vi.mocked(listResourceTags).mockResolvedValueOnce({ team: 'core' }).mockReturnValueOnce(fresh.promise);
  const page = renderPage(undefined, 'orders');
  await saveTags(page);
  await waitFor(() => expect(tagTable(page)?.findLoadingText()?.getElement()).toHaveTextContent('Loading tags'));
  expectSaved(page, 'Tags of orders saved.');
  await act(async () =>
    fresh.reject(
      new RequestError({
        kind: 'other',
        operation: 'ListTagsForResource',
        code: 'ValidationException',
        message: 'Read refused',
      }),
    ),
  );
  await waitFor(() => {
    const empty = tagTable(page)?.findEmptySlot();
    expect(empty?.findStatusIndicator()?.getElement()).toHaveTextContent('The event bus tags could not be read');
    expect(empty?.findButton()?.getElement()).toHaveAccessibleName('Retry');
  });
  expectSaved(page, 'Tags of orders saved.');
});

it('keeps the description success result when the subsequent bus read finds no bus', async () => {
  read.mockResolvedValueOnce(loaded).mockResolvedValueOnce({ kind: 'not-found' });
  const page = renderPage(undefined, 'orders');
  await saveDescription(page);
  await waitFor(() =>
    expect(page.layout.findContent().findContainer()?.findContent().getElement()).toHaveTextContent(
      'Event bus not found',
    ),
  );
  expect(read).toHaveBeenCalledTimes(2);
  expectSaved(page, 'Description of orders saved.');
});
