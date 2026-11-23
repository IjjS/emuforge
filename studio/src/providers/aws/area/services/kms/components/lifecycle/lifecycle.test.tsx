import {
  CancelKeyDeletionCommand,
  DescribeKeyCommand,
  DisableKeyCommand,
  EnableKeyCommand,
  ListKeysCommand,
  ScheduleKeyDeletionCommand,
  UpdateKeyDescriptionCommand,
  type KeyMetadata,
} from '@aws-sdk/client-kms';
import Flashbar from '@cloudscape-design/components/flashbar';
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { creationDateText } from '../../../../components/format-date';
import { PageFlashContext, type FlashResult } from '../../../../components/page-flash';
import { KeyPage } from '../../pages/key';
import { KMS_KEYS, useCustomerKeys } from '../../queries';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const KEY_ID = '1234abcd-12ab-34cd-56ef-1234567890ab';
const endpoint = 'http://127.0.0.1:8312';
const connection = {
  engineOrigin: endpoint,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9312, endpoint: 'https://127.0.0.1:9312' } },
} as const;
const deletionDate = new Date('2026-12-01T09:30:00Z');
const NOT_IMPLEMENTED = { name: 'NotImplemented', $fault: 'server', $metadata: { httpStatusCode: 501 } };

function key(state: string, extra: Partial<KeyMetadata> = {}): KeyMetadata {
  return {
    KeyId: KEY_ID,
    Arn: `arn:aws:kms:us-east-1:000000000000:key/${KEY_ID}`,
    KeyManager: 'CUSTOMER',
    KeyState: state,
    KeySpec: 'SYMMETRIC_DEFAULT',
    KeyUsage: 'ENCRYPT_DECRYPT',
    Origin: 'AWS_KMS',
    Description: 'Local orders',
    CreationDate: new Date('2026-11-20T10:00:00Z'),
    ...extra,
  } as KeyMetadata;
}

type Answer = unknown;
type Handler = (command: object) => Answer | Promise<Answer> | undefined;

/** The emulator: the key's current metadata and any answer a test overrides. */
function emulate(initial: KeyMetadata, handler: Handler = () => undefined) {
  const current = { metadata: initial };
  send.mockImplementation(async (command: object) => {
    const answer = await handler(command);
    if (answer !== undefined) return answer;
    if (command instanceof DescribeKeyCommand) return { KeyMetadata: current.metadata };
    if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }], Truncated: false };
    const name = command.constructor.name;
    if (name === 'ListAliasesCommand') return { Aliases: [], Truncated: false };
    if (name === 'ListResourceTagsCommand') return { Tags: [], Truncated: false };
    return {};
  });
  return current;
}

function ListObserver() {
  const listing = useCustomerKeys(endpoint, true, 0);
  const reading = useIsFetching({ queryKey: KMS_KEYS.list }) > 0;
  return (
    <output aria-label="List read" aria-busy={reading}>
      {(listing.items ?? []).map((item) => item.description).join(',')}
    </output>
  );
}

function Page({ observeList }: { observeList: boolean }) {
  const [flash, setFlash] = useState<FlashResult>();
  const root = useRef<HTMLDivElement>(null);
  return (
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <PageFlashContext.Provider value={{ show: setFlash, handOver: () => undefined }}>
          <Flashbar items={flash ? [...flash] : []} />
          {observeList && <ListObserver />}
          <KeyPage connection={connection} params={{ keyid: KEY_ID }} />
        </PageFlashContext.Provider>
      </div>
    </AreaRootContext.Provider>
  );
}

function open(observeList = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Page observeList={observeList} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function usable(button: HTMLElement) {
  return !(button as HTMLButtonElement).disabled && button.getAttribute('aria-disabled') !== 'true';
}

function lifecycle() {
  return screen.getByRole('group', { name: 'Key lifecycle' });
}

function usableActions() {
  return within(lifecycle())
    .getAllByRole('button')
    .filter(usable)
    .map((button) => button.textContent);
}

async function expectActions(names: string[]) {
  await waitFor(() => expect(usableActions()).toEqual(names));
}

async function expectStatus(state: string) {
  await waitFor(() => expect(field('Status')).toHaveTextContent(state));
}

function field(label: string) {
  const term = screen.getByText(label, { selector: 'dt *, dt' }).closest('dt');
  return term?.nextElementSibling as HTMLElement;
}

function action(name: string) {
  fireEvent.click(within(lifecycle()).getByRole('button', { name }));
}

function dialog() {
  return screen.getByRole('dialog');
}

async function opened(name: string) {
  action(name);
  await screen.findByRole('dialog');
}

function confirm(name: string) {
  fireEvent.click(within(dialog()).getByRole('button', { name }));
}

function flashText() {
  return document.querySelector('[class*="awsui_flashbar"]')?.textContent ?? '';
}

function sent<T>(type: new (...args: never[]) => T) {
  return send.mock.calls.filter(([command]) => command instanceof type);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  send.mockReset();
});

describe('Key lifecycle', () => {
  it('offers only the actions of an enabled key, then those of the disabled key KMS returns', async () => {
    const emulator = emulate(key('Enabled'));
    open();
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);

    await opened('Disable key');
    emulator.metadata = key('Disabled');
    confirm('Disable key');

    await expectStatus('Disabled');
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);
    expect(sent(DisableKeyCommand)).toEqual([
      [expect.objectContaining({ input: { KeyId: KEY_ID } }), { abortSignal: expect.any(AbortSignal) }],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(flashText()).toContain('Key disabled.');
  });

  it('schedules deletion of a disabled key, shows the date and then offers only cancellation', async () => {
    const emulator = emulate(key('Disabled'));
    open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);

    await opened('Schedule key deletion');
    fireEvent.change(within(dialog()).getByRole('spinbutton'), { target: { value: '7' } });
    emulator.metadata = key('PendingDeletion', { DeletionDate: deletionDate });
    confirm('Schedule deletion');

    await expectStatus('PendingDeletion');
    expect(field('Deletion date')).toHaveTextContent(creationDateText(deletionDate));
    await expectActions(['Cancel key deletion']);
    expect(sent(ScheduleKeyDeletionCommand)[0]?.[0]).toEqual(
      expect.objectContaining({ input: { KeyId: KEY_ID, PendingWindowInDays: 7 } }),
    );
    expect(flashText()).toContain('Key deletion scheduled.');

    await opened('Cancel key deletion');
    emulator.metadata = key('Disabled');
    confirm('Cancel deletion');

    await expectStatus('Disabled');
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);
    expect(screen.queryByText('Deletion date')).toBeNull();
    expect(sent(CancelKeyDeletionCommand)).toHaveLength(1);
  });

  it('keeps the new description and the result when the detail read ends before the list read', async () => {
    const list = deferred<unknown>();
    let saved = false;
    const emulator = emulate(key('Enabled'), (command) => {
      if (command instanceof ListKeysCommand && saved) return list.promise;
      return undefined;
    });
    open(true);
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveTextContent('Local orders'));
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);

    await opened('Edit description');
    fireEvent.change(within(dialog()).getByRole('textbox'), { target: { value: 'Local invoices' } });
    saved = true;
    emulator.metadata = key('Enabled', { Description: 'Local invoices' });
    confirm('Save');

    await waitFor(() => expect(field('Description')).toHaveTextContent('Local invoices'));
    expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
    expect(flashText()).toContain('Key description updated.');
    expect(sent(UpdateKeyDescriptionCommand)[0]?.[0]).toEqual(
      expect.objectContaining({ input: { KeyId: KEY_ID, Description: 'Local invoices' } }),
    );

    await act(async () => {
      list.resolve({ Keys: [{ KeyId: KEY_ID }], Truncated: false });
    });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveTextContent('Local invoices'));
    expect(field('Description')).toHaveTextContent('Local invoices');
    expect(flashText()).toContain('Key description updated.');
  });

  it('names the key and the local effect before disabling, and keeps it enabled when canceled', async () => {
    emulate(key('Enabled'));
    open();
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);

    await opened('Disable key');
    expect(dialog()).toHaveTextContent(KEY_ID);
    expect(dialog()).toHaveTextContent('your local emulator refuses every cryptographic operation that uses this key');
    confirm('Cancel');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent(DisableKeyCommand)).toHaveLength(0);
    expect(field('Status')).toHaveTextContent('Enabled');
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
  });

  it('refuses a waiting period outside 7 to 30 days and shows the allowed range', async () => {
    emulate(key('Enabled'));
    open();
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    await opened('Schedule key deletion');
    const days = within(dialog()).getByRole('spinbutton');
    const submit = () => within(dialog()).getByRole('button', { name: 'Schedule deletion' });

    for (const value of ['6', '31']) {
      fireEvent.change(days, { target: { value } });
      await waitFor(() => expect(usable(submit())).toBe(false));
      expect(dialog()).toHaveTextContent('Enter a whole number of days. From 7 to 30 days.');
      fireEvent.click(submit());
    }
    expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(0);

    fireEvent.change(days, { target: { value: '30' } });
    await waitFor(() => expect(usable(submit())).toBe(true));
    expect(dialog()).toHaveTextContent('From 7 to 30 days.');
  });

  it('keeps the result and the returned state when the detail is read again before the list', async () => {
    const list = deferred<unknown>();
    let canceled = false;
    const emulator = emulate(key('PendingDeletion', { DeletionDate: deletionDate }), (command) => {
      if (command instanceof ListKeysCommand && canceled) return list.promise;
      return undefined;
    });
    open(true);
    await expectActions(['Cancel key deletion']);
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));

    await opened('Cancel key deletion');
    canceled = true;
    emulator.metadata = key('Disabled');
    confirm('Cancel deletion');

    await expectStatus('Disabled');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
    expect(flashText()).toContain('Key deletion canceled.');

    await act(async () => {
      list.resolve({ Keys: [{ KeyId: KEY_ID }], Truncated: false });
    });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    expect(flashText()).toContain('Key deletion canceled.');
    expect(field('Status')).toHaveTextContent('Disabled');
  });

  it('names EnableKey when it is not implemented and keeps enabling on the page as unavailable', async () => {
    emulate(key('Disabled'), (command) => {
      if (command instanceof EnableKeyCommand) throw NOT_IMPLEMENTED;
      return undefined;
    });
    open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);

    action('Enable key');

    await waitFor(() => expect(flashText()).toContain('Not implemented by the emulator'));
    expect(flashText()).toContain('EnableKey');
    const enable = within(lifecycle()).getByRole('button', { name: 'Enable key' });
    expect(enable).toBeVisible();
    expect(usable(enable)).toBe(false);
    await expectActions(['Edit description', 'Schedule key deletion']);
    expect(sent(EnableKeyCommand)).toHaveLength(1);
  });
});
