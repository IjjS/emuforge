import {
  CancelKeyDeletionCommand,
  CreateAliasCommand,
  DescribeKeyCommand,
  DisableKeyCommand,
  EnableKeyCommand,
  GetKeyPolicyCommand,
  ListKeyPoliciesCommand,
  ListKeysCommand,
  NotFoundException,
  PutKeyPolicyCommand,
  RotateKeyOnDemandCommand,
  ScheduleKeyDeletionCommand,
  UpdateKeyDescriptionCommand,
  type KeyMetadata,
} from '@aws-sdk/client-kms';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { AreaFlash, FlashAnnouncer } from '../../../../components/area-flash';
import type { AreaConnection } from '../../../../components/emulator-line';
import { creationDateText } from '../../../../components/format-date';
import { PageFlashContext, type FlashResult } from '../../../../components/page-flash';
import { useAreaFlash } from '../../../../components/use-area-flash';
import { KeyPage } from '../../pages/key';
import { keyPath, KEYS_PATH } from '../../paths';
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
const PAGE = createWrapper(document.body);

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

function Page({
  observeList,
  keyId,
  target,
  onFlash,
}: {
  observeList: boolean;
  keyId: string;
  target: AreaConnection;
  onFlash: ((result: FlashResult) => void) | undefined;
}) {
  const flash = useAreaFlash(keyPath(keyId), 0, true);
  const root = useRef<HTMLDivElement>(null);
  return (
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <PageFlashContext.Provider
          value={{
            show: (result) => {
              onFlash?.(result);
              flash.pageFlash.show(result);
            },
            handOver: flash.pageFlash.handOver,
          }}
        >
          <FlashAnnouncer announcement={flash.announcement} />
          {flash.shown !== null && (
            <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />
          )}
          {observeList && <ListObserver />}
          <main>
            <KeyPage connection={target} params={{ keyid: keyId }} />
          </main>
        </PageFlashContext.Provider>
      </div>
    </AreaRootContext.Provider>
  );
}

function open(
  observeList = false,
  client = new QueryClient(),
  initialTarget: AreaConnection = connection,
  onFlash?: (result: FlashResult) => void,
) {
  const page = (keyId: string, target: AreaConnection) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page observeList={observeList} keyId={keyId} target={target} onFlash={onFlash} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(page(KEY_ID, initialTarget));
  return (keyId: string, target: AreaConnection = connection) => view.rerender(page(keyId, target));
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
  return PAGE.findTabs()
    ?.findTabContent()
    ?.findAllKeyValuePairs()
    .flatMap((pairs) => pairs.findItems())
    .find((item) => item.findLabel()?.getElement().textContent === label)
    ?.findValue()
    ?.getElement();
}

function action(name: string) {
  fireEvent.click(within(lifecycle()).getByRole('button', { name }));
}

function dialog() {
  const modal = PAGE.findModal();
  if (!modal) throw new Error('Missing lifecycle dialog');
  return modal;
}

async function opened(name: string) {
  action(name);
  await waitFor(() => expect(dialog().findHeader().getElement()).toHaveTextContent(name));
}

function dialogButton(name: string) {
  const footer = dialog().findFooter();
  if (!footer) throw new Error('Missing lifecycle dialog footer');
  return within(footer.getElement()).getByRole('button', { name });
}

function confirm(name: string) {
  fireEvent.click(dialogButton(name));
}

function flashText(type: 'success' | 'info' = 'success') {
  return PAGE.findFlashbar()?.findItemsByType(type)[0]?.getElement().textContent ?? '';
}

function sent<T>(type: new (...args: never[]) => T) {
  return send.mock.calls.filter(([command]) => command instanceof type);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
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

describe('Key detail panel lifetime', () => {
  const refreshFailureAnnouncement = 'Key metadata could not be refreshed. Showing the last successful read.';

  function selectTab(id: string) {
    const tab = PAGE.findTabs()?.findTabLinkById(id);
    if (!tab) throw new Error(`Missing key tab ${id}`);
    fireEvent.click(tab.getElement());
  }

  function panelButton(name: string) {
    const panel = PAGE.findTabs()?.findTabContent();
    if (!panel) throw new Error('Missing active key panel');
    return within(panel.getElement()).getByRole('button', { name });
  }

  const rotateButton = () => panelButton('Rotate now');

  it.each([
    {
      tab: 'labels',
      openerName: 'Create alias',
      fieldName: 'Alias name',
      draft: 'r9-alias',
      submitName: 'Create alias',
      commandType: CreateAliasCommand,
      refusal: false,
    },
    {
      tab: 'access',
      openerName: 'Edit key policy',
      fieldName: 'Policy document',
      draft: '{"Version":"2012-10-17","Statement":[],"Id":"r9-policy"}',
      submitName: 'Save policy',
      commandType: PutKeyPolicyCommand,
      refusal: true,
    },
  ])('releases the $openerName modal on a missing key and announces the late result once', async (scenario) => {
    const readback = deferred<unknown>();
    const write = deferred<unknown>();
    const published = vi.fn<(result: FlashResult) => void>();
    let reads = 0;
    emulate(key('Enabled'), (command) => {
      if (command instanceof DescribeKeyCommand && ++reads > 1) return readback.promise;
      if (command instanceof ListKeyPoliciesCommand) return { PolicyNames: ['default'] };
      if (command instanceof GetKeyPolicyCommand) return { Policy: '{"Version":"2012-10-17","Statement":[]}' };
      if (command instanceof scenario.commandType) return write.promise;
      return undefined;
    });
    open(false, new QueryClient(), connection, published);
    const user = userEvent.setup();
    await expectStatus('Enabled');
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(2));
    selectTab(scenario.tab);
    const opener = panelButton(scenario.openerName);
    await waitFor(() => expect(usable(opener)).toBe(true));
    opener.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(dialog().findHeader().getElement()).toHaveTextContent(scenario.openerName));
    const content = dialog().findContent();
    fireEvent.change(within(content.getElement()).getByRole('textbox', { name: scenario.fieldName }), {
      target: { value: scenario.draft },
    });
    const submit = dialogButton(scenario.submitName);
    submit.focus();
    await user.keyboard('{Enter}');
    const writes = () => send.mock.calls.filter(([command]) => command instanceof scenario.commandType);
    await waitFor(() => expect(writes()).toHaveLength(1));
    const options = writes()[0]?.[1] as { abortSignal: AbortSignal } | undefined;
    if (!options) throw new Error('Missing panel request signal');

    await act(async () =>
      readback.reject(new NotFoundException({ message: 'Key not found', $metadata: { httpStatusCode: 400 } })),
    );
    expect(await screen.findByText('Key not found')).toBeVisible();
    const back = screen.getByRole('link', { name: 'View customer managed keys' });
    expect(back).toHaveAttribute('href', KEYS_PATH);
    await waitFor(() => expect(back).toHaveFocus());
    expect(PAGE.findModal()).toBeNull();
    await user.tab({ shift: true });
    expect(refresh).toHaveFocus();
    await user.tab();
    expect(back).toHaveFocus();
    expect(options.abortSignal.aborted).toBe(false);
    fireEvent.click(opener);
    expect(writes()).toHaveLength(1);
    expect(published).not.toHaveBeenCalled();

    if (scenario.refusal) {
      await act(async () =>
        write.reject({
          name: 'AccessDeniedException',
          message: 'Policy edit refused.',
          $fault: 'client',
          $metadata: { httpStatusCode: 400 },
        }),
      );
      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent('PutKeyPolicy was refused: Policy edit refused.');
      expect(screen.getAllByRole('alert')).toEqual([notice]);
    } else {
      await act(async () => write.resolve({}));
      const notice = await screen.findByText('Success Alias created.');
      expect(notice.parentElement).toHaveAttribute('role', 'status');
      expect(screen.getAllByText('Success Alias created.')).toEqual([notice]);
    }
    expect(published).toHaveBeenCalledTimes(1);
    expect(options.abortSignal.aborted).toBe(false);
    expect(back).toHaveFocus();
    expect(PAGE.findModal()).toBeNull();
    expect(usable(opener)).toBe(false);
    fireEvent.click(opener);
    expect(writes()).toHaveLength(1);
  });

  async function holdRotationThroughMissingKey() {
    const write = deferred<unknown>();
    const onFlash = vi.fn<(result: FlashResult) => void>();
    let missing = false;
    emulate(key('Enabled'), (command) => {
      if (command instanceof DescribeKeyCommand) {
        if (missing) throw new NotFoundException({ message: 'Key not found', $metadata: { httpStatusCode: 400 } });
        return { KeyMetadata: key('Enabled', { KeyId: command.input.KeyId ?? KEY_ID }) };
      }
      if (command instanceof RotateKeyOnDemandCommand) return write.promise;
      return undefined;
    });
    const changeVisit = open(false, new QueryClient(), connection, onFlash);
    await expectStatus('Enabled');
    selectTab('rotation');
    const rotate = rotateButton();
    fireEvent.click(rotate);
    await waitFor(() => expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1));
    const options = sent(RotateKeyOnDemandCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;
    if (!options) throw new Error('Missing rotation request signal');

    missing = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Key not found')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View customer managed keys' })).toBeVisible();
    expect(rotate).toBeInTheDocument();
    expect(rotate).not.toBeVisible();
    expect(options.abortSignal.aborted).toBe(false);
    expect(onFlash).not.toHaveBeenCalled();
    return {
      write,
      rotate,
      signal: options.abortSignal,
      onFlash,
      changeVisit: (keyId: string, target: AreaConnection) => {
        missing = false;
        changeVisit(keyId, target);
      },
    };
  }

  it('delivers a held rotation once when Refresh reports the same key missing and blocks new writes', async () => {
    const { write, rotate, signal, onFlash } = await holdRotationThroughMissingKey();
    fireEvent.click(rotate);
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);

    await act(async () => write.resolve({}));
    await waitFor(() => expect(flashText()).toContain('On-demand rotation requested.'));
    expect(onFlash).toHaveBeenCalledTimes(1);
    const notices = PAGE.findFlashbar()?.findItemsByType('success');
    expect(notices).toHaveLength(1);
    expect(notices?.[0]?.findContent()?.getElement()).toHaveTextContent('On-demand rotation requested.');
    expect(signal.aborted).toBe(false);
    expect(screen.getByText('Key not found')).toBeVisible();
    expect(rotate).toBeDisabled();
    fireEvent.click(rotate);
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);
  });

  it.each([
    { change: 'key', keyId: 'different-key', target: connection },
    { change: 'target', keyId: KEY_ID, target: { ...connection, engineOrigin: 'http://127.0.0.1:8313' } },
  ])('cancels the held rotation on a change of $change after the missing-key read', async ({ keyId, target }) => {
    const { write, rotate, signal, onFlash, changeVisit } = await holdRotationThroughMissingKey();
    changeVisit(keyId, target);
    await waitFor(() => expect(field('Key ID')).toHaveTextContent(keyId));
    expect(signal.aborted).toBe(true);
    expect(rotate).not.toBeInTheDocument();

    await act(async () => write.resolve({}));
    expect(onFlash).not.toHaveBeenCalled();
    expect(flashText()).toBe('');
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);
  });

  it('announces the initial metadata failure once before and after the frame detects it, then recovers on Retry', async () => {
    const firstRead = deferred<unknown>();
    let reads = 0;
    emulate(key('Enabled'), (command) =>
      command instanceof DescribeKeyCommand && ++reads === 1 ? firstRead.promise : undefined,
    );
    const showTarget = open(false, new QueryClient(), { ...connection, result: undefined });
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(1));
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();

    await act(async () => firstRead.reject(new TypeError('Failed to fetch')));
    const text = 'Key metadata could not be loaded. Choose Retry to try again.';
    const announcement = await screen.findByText(text);
    expect(announcement).toHaveAttribute('role', 'status');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
    expect(refresh).toHaveFocus();
    const recovery = PAGE.findContentLayout()?.findContent().findContainer()?.findContent().getElement();
    if (!recovery) throw new Error('Missing metadata recovery');
    expect(recovery).toHaveTextContent(`The EmuForge engine at ${endpoint} is not answering`);
    expect(within(recovery).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');

    const observed = vi.fn();
    const observer = new MutationObserver(observed);
    observer.observe(announcement, { childList: true, characterData: true, subtree: true });
    try {
      await act(async () => {
        showTarget(KEY_ID, {
          ...connection,
          result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: connection.result.emulator.port },
        });
      });
      expect(screen.getAllByText(text)).toEqual([announcement]);
      expect(observer.takeRecords()).toHaveLength(0);
      expect(observed).not.toHaveBeenCalled();
      expect(refresh).toHaveFocus();
    } finally {
      observer.disconnect();
    }

    const retry = within(recovery).getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    await expectStatus('Enabled');
    await waitFor(() => expect(retry).not.toBeInTheDocument());
    expect(announcement).toBeEmptyDOMElement();
    expect(refresh).toHaveFocus();
    expect(sent(DescribeKeyCommand)).toHaveLength(2);
  });

  it('blocks new panel writes before initial metadata succeeds and unlocks them after Retry', async () => {
    const metadata = deferred<unknown>();
    const retry = deferred<unknown>();
    let reads = 0;
    emulate(key('Enabled'), (command) => {
      if (command instanceof DescribeKeyCommand) return ++reads === 1 ? metadata.promise : retry.promise;
      return undefined;
    });
    const actions = [
      ['labels', ['Create alias', 'Add tag']],
      ['access', ['Create grant']],
      ['rotation', ['Rotate now']],
    ] as const;
    function expectBlockedWrites() {
      for (const [tab, buttons] of actions) {
        selectTab(tab);
        for (const name of buttons) {
          const button = panelButton(name);
          expect(usable(button)).toBe(false);
          fireEvent.click(button);
        }
        expect(PAGE.findModal()).toBeNull();
      }
      expect(sent(RotateKeyOnDemandCommand)).toHaveLength(0);
    }

    open();
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(1));
    expect(field('Status')).toBeUndefined();
    expectBlockedWrites();

    await act(async () => {
      metadata.reject({
        name: 'DependencyTimeoutException',
        message: 'Initial DescribeKey failed.',
        $fault: 'server',
        $metadata: { httpStatusCode: 500 },
      });
    });
    expect(await screen.findByText(/Initial DescribeKey failed/)).toBeVisible();
    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeVisible();
    expectBlockedWrites();

    fireEvent.click(retryButton);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(2));
    expectBlockedWrites();
    await act(async () => retry.resolve({ KeyMetadata: key('Enabled') }));
    await waitFor(() => expect(usable(rotateButton())).toBe(true));
    expect(screen.queryByText(/Initial DescribeKey failed/)).toBeNull();
    for (const [tab, buttons] of actions) {
      selectTab(tab);
      for (const name of buttons) expect(usable(panelButton(name))).toBe(true);
    }
    fireEvent.click(rotateButton());
    await waitFor(() => expect(flashText()).toContain('On-demand rotation requested.'));
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);
    selectTab('details');
    await expectStatus('Enabled');
  });

  it('keeps a pending rotation and its result through tab changes and a failed metadata refresh', async () => {
    const write = deferred<unknown>();
    let refuseMetadata = false;
    const reason = 'DescribeKey temporarily failed.';
    emulate(key('Enabled'), (command) => {
      if (command instanceof RotateKeyOnDemandCommand) return write.promise;
      if (command instanceof DescribeKeyCommand && refuseMetadata) {
        throw {
          name: 'DependencyTimeoutException',
          message: reason,
          $fault: 'server',
          $metadata: { httpStatusCode: 500 },
        };
      }
      return undefined;
    });
    open();
    await expectStatus('Enabled');

    selectTab('rotation');
    fireEvent.click(rotateButton());
    await waitFor(() => expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1));
    const writeOptions = sent(RotateKeyOnDemandCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;
    selectTab('details');
    expect(writeOptions?.abortSignal.aborted).toBe(false);

    refuseMetadata = true;
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    fireEvent.click(refresh);
    expect(await screen.findByText(/DescribeKey temporarily failed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    const announcement = await screen.findByText(refreshFailureAnnouncement);
    expect(announcement).toHaveAttribute('role', 'status');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
    expect(refresh).toHaveFocus();
    expect(field('Status')).toHaveTextContent('Enabled');
    expect(writeOptions?.abortSignal.aborted).toBe(false);

    selectTab('rotation');
    expect(rotateButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(rotateButton());
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);
    selectTab('details');
    await act(async () => write.resolve({}));
    await waitFor(() => expect(flashText()).toContain('On-demand rotation requested.'));
    expect(writeOptions?.abortSignal.aborted).toBe(false);

    selectTab('rotation');
    expect(usable(rotateButton())).toBe(true);
    expect(flashText()).toContain('On-demand rotation requested.');
    expect(screen.getAllByText(refreshFailureAnnouncement)).toEqual([announcement]);
    refuseMetadata = false;
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(/DescribeKey temporarily failed/)).toBeNull());
    expect(refresh).toHaveFocus();
    expect(announcement).toBeEmptyDOMElement();
    expect(usable(rotateButton())).toBe(true);
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);
  });

  it('keeps user-moved focus when a metadata retry succeeds', async () => {
    const retryReply = deferred<unknown>();
    let reads = 0;
    emulate(key('Enabled'), (command) => {
      if (!(command instanceof DescribeKeyCommand)) return undefined;
      reads += 1;
      if (reads === 2) {
        throw {
          name: 'DependencyTimeoutException',
          message: 'DescribeKey temporarily failed.',
          $fault: 'server',
          $metadata: { httpStatusCode: 500 },
        };
      }
      return reads === 3 ? retryReply.promise : undefined;
    });
    open();
    await expectStatus('Enabled');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(3));

    const detailsTab = PAGE.findTabs()?.findTabLinkById('details')?.getElement();
    if (!detailsTab) throw new Error('Missing Details tab');
    detailsTab.focus();
    expect(detailsTab).toHaveFocus();

    await act(async () => retryReply.resolve({ KeyMetadata: key('Disabled') }));
    await expectStatus('Disabled');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(detailsTab).toHaveFocus();
  });

  it('retains an operation-specific rotation 501 on return and resets it for a new key', async () => {
    const otherKeyId = '0987abcd-12ab-34cd-56ef-1234567890ab';
    emulate(key('Enabled'), (command) => {
      if (command instanceof DescribeKeyCommand && command.input.KeyId === otherKeyId) {
        return { KeyMetadata: key('Enabled', { KeyId: otherKeyId }) };
      }
      if (command instanceof RotateKeyOnDemandCommand && command.input.KeyId === KEY_ID) throw NOT_IMPLEMENTED;
      return undefined;
    });
    const changeKey = open();
    await expectStatus('Enabled');
    selectTab('rotation');
    fireEvent.click(rotateButton());
    await waitFor(() => expect(flashText('info')).toContain('RotateKeyOnDemand'));
    expect(rotateButton()).toBeDisabled();

    selectTab('details');
    selectTab('rotation');
    expect(rotateButton()).toBeDisabled();
    expect(rotateButton()).toHaveAccessibleDescription('The emulator does not implement RotateKeyOnDemand.');
    fireEvent.click(rotateButton());
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(1);

    changeKey(otherKeyId);
    await waitFor(() => expect(field('Key ID')).toHaveTextContent(otherKeyId));
    selectTab('rotation');
    expect(usable(rotateButton())).toBe(true);
    fireEvent.click(rotateButton());
    await waitFor(() => expect(flashText()).toContain('On-demand rotation requested.'));
    expect(sent(RotateKeyOnDemandCommand)).toHaveLength(2);
    expect(sent(RotateKeyOnDemandCommand)[1]?.[0]).toEqual(expect.objectContaining({ input: { KeyId: otherKeyId } }));
  });
});

describe('Key lifecycle', () => {
  const disableRefusal = {
    name: 'KMSInvalidStateException',
    message: 'The key cannot be disabled now.',
    $fault: 'client',
    $metadata: { httpStatusCode: 400 },
  };

  async function holdDisableDuringRefresh() {
    const readback = deferred<unknown>();
    const write = deferred<unknown>();
    const published = vi.fn<(result: FlashResult) => void>();
    let reads = 0;
    emulate(key('Enabled'), (command) => {
      if (command instanceof DescribeKeyCommand) {
        if (++reads === 2) return readback.promise;
        return { KeyMetadata: key('Enabled', { KeyId: command.input.KeyId ?? KEY_ID }) };
      }
      if (command instanceof DisableKeyCommand) return write.promise;
      return undefined;
    });
    const changeIdentity = open(false, new QueryClient(), connection, published);
    const user = userEvent.setup();
    await expectStatus('Enabled');
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(2));
    const opener = within(lifecycle()).getByRole('button', { name: 'Disable key' });
    opener.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(dialog().findHeader().getElement()).toHaveTextContent('Disable key'));
    const submit = dialogButton('Disable key');
    submit.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent(DisableKeyCommand)).toHaveLength(1));
    const options = sent(DisableKeyCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;
    if (!options) throw new Error('Missing lifecycle request signal');
    return {
      changeIdentity,
      refresh,
      write,
      published,
      signal: options.abortSignal,
      async reportMissing() {
        await act(async () =>
          readback.reject(new NotFoundException({ message: 'Key not found', $metadata: { httpStatusCode: 400 } })),
        );
        expect(await screen.findByText('Key not found')).toBeVisible();
        const back = screen.getByRole('link', { name: 'View customer managed keys' });
        expect(back).toHaveAttribute('href', KEYS_PATH);
        await waitFor(() => expect(back).toHaveFocus());
        expect(PAGE.findModal()).toBeNull();
        await user.tab({ shift: true });
        expect(refresh).toHaveFocus();
        await user.tab();
        expect(back).toHaveFocus();
        expect(options.abortSignal.aborted).toBe(false);
        return back;
      },
    };
  }

  it.each([false, true])(
    'announces one late DisableKey refusal after the modal closes (key recovered: %s)',
    async (recover) => {
      const { refresh, write, published, signal, reportMissing } = await holdDisableDuringRefresh();
      const back = await reportMissing();
      if (recover) {
        fireEvent.click(refresh);
        await expectStatus('Enabled');
        expect(PAGE.findModal()).toBeNull();
        expect(screen.queryByText('Key not found')).toBeNull();
      }
      await act(async () => write.reject(disableRefusal));
      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent('DisableKey failed');
      expect(notice).toHaveTextContent(disableRefusal.message);
      expect(screen.getAllByRole('alert')).toEqual([notice]);
      expect(published).toHaveBeenCalledTimes(1);
      expect(published.mock.calls[0]?.[0][0]).not.toHaveProperty('announcedInDialog');
      expect(signal.aborted).toBe(false);
      expect(PAGE.findModal()).toBeNull();
      expect(sent(DisableKeyCommand)).toHaveLength(1);
      if (!recover) expect(back).toHaveFocus();
    },
  );

  it('announces a DisableKey refusal in the original dialog while it remains open', async () => {
    const { write, published, signal } = await holdDisableDuringRefresh();
    await act(async () => write.reject(disableRefusal));
    const content = dialog().findContent().getElement();
    const notice = await within(content).findByRole('alert');
    expect(notice).toHaveTextContent('DisableKey failed');
    expect(notice).toHaveTextContent(disableRefusal.message);
    expect(screen.getAllByRole('alert')).toEqual([notice]);
    expect(published).toHaveBeenCalledTimes(1);
    expect(published.mock.calls[0]?.[0][0]).toHaveProperty('announcedInDialog', true);
    expect(signal.aborted).toBe(false);
    expect(sent(DisableKeyCommand)).toHaveLength(1);
  });

  it.each([
    { change: 'key', keyId: 'different-key', target: connection },
    { change: 'target', keyId: KEY_ID, target: { ...connection, engineOrigin: 'http://127.0.0.1:8313' } },
  ])('aborts a pending DisableKey on $change change after the key goes missing', async ({ keyId, target }) => {
    const { changeIdentity, write, published, signal, reportMissing } = await holdDisableDuringRefresh();
    await reportMissing();
    changeIdentity(keyId, target);
    await waitFor(() => expect(field('Key ID')).toHaveTextContent(keyId));
    expect(signal.aborted).toBe(true);

    await act(async () => write.reject(disableRefusal));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(published).not.toHaveBeenCalled();
    expect(PAGE.findModal()).toBeNull();
    expect(sent(DisableKeyCommand)).toHaveLength(1);
  });

  it('keeps an open draft offline, blocks its submission, and preserves a later pending save during an outage', async () => {
    const write = deferred<unknown>();
    const emulator = emulate(key('Enabled'), (command) =>
      command instanceof UpdateKeyDescriptionCommand ? write.promise : undefined,
    );
    const showTarget = open();
    const outage: AreaConnection['result'] = {
      kind: 'emulator-unreachable',
      reason: 'timeout',
      message: '',
      checkedAt: 1,
      emulator: connection.result.emulator,
    };
    const draft = 'Local invoices';
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    await opened('Edit description');
    const description = within(dialog().findContent().getElement()).getByRole('textbox');
    fireEvent.change(description, { target: { value: draft } });
    const save = dialogButton('Save');
    expect(usable(save)).toBe(true);
    save.focus();

    showTarget(KEY_ID, { ...connection, result: outage });
    expect(dialog().findHeader().getElement()).toHaveTextContent('Edit description');
    expect(description).toHaveValue(draft);
    expect(save).toHaveFocus();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAccessibleDescription('Reconnect to the emulator to save the key description.');
    const notice = within(dialog().findContent().getElement()).getByRole('status');
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('Reconnect to the emulator to save the key description.');
    confirm('Save');
    expect(sent(UpdateKeyDescriptionCommand)).toHaveLength(0);

    showTarget(KEY_ID, { ...connection, result: { ...connection.result, checkedAt: 2 } });
    expect(description).toHaveValue(draft);
    expect(usable(dialogButton('Save'))).toBe(true);
    expect(notice).toBeEmptyDOMElement();
    confirm('Save');
    await waitFor(() => expect(sent(UpdateKeyDescriptionCommand)).toHaveLength(1));
    const options = sent(UpdateKeyDescriptionCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;

    showTarget(KEY_ID, { ...connection, result: { ...outage, checkedAt: 3 } });
    expect(description).toHaveValue(draft);
    expect(dialogButton('Save')).toHaveAttribute('aria-disabled', 'true');
    expect(dialogButton('Save')).not.toBeDisabled();
    expect(save).toHaveFocus();
    expect(notice).toBeEmptyDOMElement();
    confirm('Save');
    expect(sent(UpdateKeyDescriptionCommand)).toHaveLength(1);
    expect(options?.abortSignal.aborted).toBe(false);

    emulator.metadata = key('Enabled', { Description: draft });
    await act(async () => write.resolve({}));
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    expect(flashText()).toContain('Key description updated.');
    expect(options?.abortSignal.aborted).toBe(false);
    showTarget(KEY_ID, { ...connection, result: { ...connection.result, checkedAt: 4 } });
    await waitFor(() => expect(field('Description')).toHaveTextContent(draft));
  });

  it('blocks submission when refreshed metadata makes an open Disable key dialog ineligible', async () => {
    const client = new QueryClient();
    const emulator = emulate(key('Enabled'));
    open(false, client);
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    await opened('Disable key');
    const submit = dialogButton('Disable key');
    expect(usable(submit)).toBe(true);
    submit.focus();

    emulator.metadata = key('Disabled');
    await act(async () => client.invalidateQueries({ queryKey: KMS_KEYS.detail(KEY_ID) }));
    await expectStatus('Disabled');
    expect(dialog().findContent().getElement()).toHaveTextContent(KEY_ID);
    expect(submit).toHaveFocus();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toHaveAccessibleDescription('This key is already Disabled.');
    const notice = within(dialog().findContent().getElement()).getByRole('status');
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('This key is already Disabled.');
    expect(dialog().findContent().getElement()).not.toHaveTextContent("The key's state becomes Disabled");
    confirm('Disable key');
    expect(sent(DisableKeyCommand)).toHaveLength(0);

    confirm('Cancel');
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    expect(field('Status')).toHaveTextContent('Disabled');
    expect(sent(DisableKeyCommand)).toHaveLength(0);
  });

  it('keeps a held write on the same offline target and gates new writes until reconnect', async () => {
    const write = deferred<unknown>();
    const emulator = emulate(key('Disabled'), (command) => {
      if (command instanceof EnableKeyCommand) return write.promise;
      return undefined;
    });
    const showTarget = open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);
    action('Enable key');
    await waitFor(() => expect(sent(EnableKeyCommand)).toHaveLength(1));
    const options = sent(EnableKeyCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;

    showTarget(KEY_ID, {
      ...connection,
      result: {
        kind: 'emulator-unreachable',
        reason: 'timeout',
        message: '',
        checkedAt: 1,
        emulator: connection.result.emulator,
      },
    });
    const recovery = PAGE.findContentLayout()?.findContent().findContainer()?.findContent().getElement();
    if (!recovery) throw new Error('Missing metadata recovery');
    expect(recovery).toHaveTextContent(`Not answering at ${connection.result.emulator.endpoint}`);
    expect(within(recovery).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(field('Status')).toHaveTextContent('Disabled');
    await expectActions([]);
    expect(options?.abortSignal.aborted).toBe(false);

    emulator.metadata = key('Enabled');
    await act(async () => write.resolve({}));
    await waitFor(() => expect(flashText()).toContain('Key enabled.'));
    await expectActions([]);
    action('Enable key');
    expect(sent(EnableKeyCommand)).toHaveLength(1);

    showTarget(KEY_ID, { ...connection, result: { ...connection.result, checkedAt: 2 } });
    await expectStatus('Enabled');
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(flashText()).toContain('Key enabled.');
    expect(options?.abortSignal.aborted).toBe(false);
  });

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
    expect(PAGE.findModal()).toBeNull();
    expect(flashText()).toContain('Key disabled.');
  });

  it('blocks all lifecycle writes until Retry confirms the state after scheduling deletion', async () => {
    const readback = deferred<unknown>();
    const retry = deferred<unknown>();
    let reads = 0;
    emulate(key('Enabled'), (command) => {
      if (!(command instanceof DescribeKeyCommand)) return undefined;
      reads += 1;
      if (reads === 2) return readback.promise;
      return reads === 3 ? retry.promise : undefined;
    });
    open();
    await expectStatus('Enabled');
    const opener = within(lifecycle()).getByRole('button', { name: 'Schedule key deletion' });
    await opened('Schedule key deletion');
    dialogButton('Schedule deletion').focus();
    confirm('Schedule deletion');
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(2));
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    const expectWriteLock = () => {
      for (const name of ['Edit description', 'Disable key', 'Schedule key deletion']) {
        const button = within(lifecycle()).getByRole('button', { name });
        expect(usable(button)).toBe(false);
        expect(button).toHaveAccessibleDescription('Wait for Studio to confirm the current key state.');
        fireEvent.click(button);
      }
      expect(PAGE.findModal()).toBeNull();
      expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(1);
      expect(sent(UpdateKeyDescriptionCommand)).toHaveLength(0);
      expect(sent(DisableKeyCommand)).toHaveLength(0);
      expect(sent(EnableKeyCommand)).toHaveLength(0);
      expect(sent(CancelKeyDeletionCommand)).toHaveLength(0);
      expect(field('Status')).toHaveTextContent('Enabled');
      expect(flashText()).toContain('Key deletion scheduled.');
    };
    expectWriteLock();
    expect(field('Status')).toHaveTextContent('Last known. Confirming current state…');

    await act(async () =>
      readback.reject({
        name: 'DependencyTimeoutException',
        message: 'DescribeKey readback failed.',
        $fault: 'server',
        $metadata: { httpStatusCode: 500 },
      }),
    );
    const recovery = await waitFor(() => {
      const content = PAGE.findContentLayout()?.findContent().findContainer()?.findContent().getElement();
      if (!content) throw new Error('Missing metadata recovery');
      expect(content).toHaveTextContent('DescribeKey readback failed.');
      return content;
    });
    expectWriteLock();
    expect(field('Status')).toHaveTextContent('Last known. Studio could not confirm the current state.');

    const retryButton = within(recovery).getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeVisible();
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    const breadcrumbs = document.createElement('nav');
    breadcrumbs.setAttribute('aria-label', 'Breadcrumbs');
    breadcrumbs.style.position = 'sticky';
    screen.getByRole('main').prepend(breadcrumbs);
    vi.spyOn(breadcrumbs, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 56, 390, 40));
    vi.spyOn(refresh, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 83, 40, 32));
    const revealRefresh = vi.fn();
    Object.defineProperty(refresh, 'scrollIntoView', { value: revealRefresh });
    retryButton.focus();
    fireEvent.click(retryButton);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(3));
    expectWriteLock();
    expect(field('Status')).toHaveTextContent('Last known. Confirming current state…');
    expect(revealRefresh).not.toHaveBeenCalled();

    await act(async () => retry.resolve({ KeyMetadata: key('PendingDeletion', { DeletionDate: deletionDate }) }));
    await expectStatus('PendingDeletion');
    await expectActions(['Cancel key deletion']);
    expect(field('Status')).not.toHaveTextContent('Last known');
    expect(refresh).toHaveFocus();
    expect(revealRefresh).toHaveBeenCalledExactlyOnceWith({ block: 'center', inline: 'nearest' });
    expect(field('Deletion date')).toHaveTextContent(creationDateText(deletionDate));
    expect(retryButton).not.toBeInTheDocument();
    expect(flashText()).toContain('Key deletion scheduled.');
    expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(1);
    expect(sent(CancelKeyDeletionCommand)).toHaveLength(0);
  });

  it('schedules deletion of a disabled key, shows the date and then offers only cancellation', async () => {
    const emulator = emulate(key('Disabled'));
    open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);

    await opened('Schedule key deletion');
    fireEvent.change(within(dialog().findContent().getElement()).getByRole('spinbutton'), { target: { value: '7' } });
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
    expect(field('Deletion date')).toBeUndefined();
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
    fireEvent.change(within(dialog().findContent().getElement()).getByRole('textbox'), {
      target: { value: 'Local invoices' },
    });
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
    expect(dialog().findContent().getElement()).toHaveTextContent(KEY_ID);
    expect(dialog().findContent().getElement()).toHaveTextContent(
      "The key's state becomes Disabled in your local emulator.",
    );
    confirm('Cancel');

    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    expect(sent(DisableKeyCommand)).toHaveLength(0);
    expect(field('Status')).toHaveTextContent('Enabled');
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
  });

  it('refuses a waiting period outside 7 to 30 days and shows the allowed range', async () => {
    emulate(key('Enabled'));
    open();
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    await opened('Schedule key deletion');
    const waitingPeriod = dialog().findContent().findFormField();
    if (!waitingPeriod) throw new Error('Missing waiting period field');
    const control = waitingPeriod.findControl();
    if (!control) throw new Error('Missing waiting period control');
    const days = within(control.getElement()).getByRole('spinbutton');
    const submit = () => dialogButton('Schedule deletion');

    for (const value of ['6', '31']) {
      fireEvent.change(days, { target: { value } });
      await waitFor(() => expect(usable(submit())).toBe(false));
      expect(waitingPeriod.findError()?.getElement()).toHaveTextContent(
        'Enter a whole number of days. From 7 to 30 days.',
      );
      fireEvent.click(submit());
    }
    expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(0);

    fireEvent.change(days, { target: { value: '30' } });
    await waitFor(() => expect(usable(submit())).toBe(true));
    expect(waitingPeriod.findConstraint()?.getElement()).toHaveTextContent('From 7 to 30 days.');
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
    expect(PAGE.findModal()).toBeNull();
    expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
    expect(flashText()).toContain('Key deletion canceled.');

    await act(async () => {
      list.resolve({ Keys: [{ KeyId: KEY_ID }], Truncated: false });
    });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    expect(flashText()).toContain('Key deletion canceled.');
    expect(field('Status')).toHaveTextContent('Disabled');
  });

  it('keeps an in-flight lifecycle write and its result when Refresh starts an older detail read', async () => {
    const write = deferred<unknown>();
    const refresh = deferred<unknown>();
    let holdRefresh = false;
    const emulator = emulate(key('Disabled'), (command) => {
      if (command instanceof EnableKeyCommand) return write.promise;
      if (command instanceof DescribeKeyCommand && holdRefresh) {
        holdRefresh = false;
        return refresh.promise;
      }
      return undefined;
    });
    open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);
    const enable = within(lifecycle()).getByRole('button', { name: 'Enable key' });
    enable.focus();
    fireEvent.click(enable);
    await waitFor(() => expect(sent(EnableKeyCommand)).toHaveLength(1));
    const writeOptions = sent(EnableKeyCommand)[0]?.[1] as { abortSignal: AbortSignal } | undefined;
    expect(enable).toHaveFocus();
    expect(enable).not.toBeDisabled();
    expect(enable).toHaveAttribute('aria-disabled', 'true');
    expect(within(lifecycle()).getByRole('button', { name: 'Edit description' })).toBeDisabled();
    expect(within(lifecycle()).getByRole('button', { name: 'Schedule key deletion' })).toBeDisabled();
    fireEvent.click(enable);
    expect(sent(EnableKeyCommand)).toHaveLength(1);

    holdRefresh = true;
    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    refreshButton.focus();
    fireEvent.click(refreshButton);
    await waitFor(() => expect(sent(DescribeKeyCommand)).toHaveLength(2));
    expect(refreshButton).toHaveFocus();
    expect(refreshButton).not.toBeDisabled();
    expect(refreshButton).toHaveAttribute('aria-disabled', 'true');
    expect(field('Status')).toHaveTextContent('Disabled');
    expect(usable(within(lifecycle()).getByRole('button', { name: 'Enable key' }))).toBe(false);
    expect(writeOptions?.abortSignal.aborted).toBe(false);

    emulator.metadata = key('Enabled');
    await act(async () => write.resolve({}));
    await expectStatus('Enabled');
    expect(flashText()).toContain('Key enabled.');
    await waitFor(() => expect(refreshButton).not.toHaveAttribute('aria-disabled', 'true'));
    expect(refreshButton).toHaveFocus();

    await act(async () => refresh.resolve({ KeyMetadata: key('Disabled') }));
    expect(field('Status')).toHaveTextContent('Enabled');
    expect(flashText()).toContain('Key enabled.');
    expect(sent(EnableKeyCommand)).toHaveLength(1);
  });

  it('returns focus to the unavailable opener when a lifecycle dialog closes after a 501', async () => {
    emulate(key('Enabled'), (command) => {
      if (command instanceof ScheduleKeyDeletionCommand) throw NOT_IMPLEMENTED;
      return undefined;
    });
    open();
    await expectActions(['Edit description', 'Disable key', 'Schedule key deletion']);
    await opened('Schedule key deletion');
    dialogButton('Schedule deletion').focus();
    confirm('Schedule deletion');

    const opener = within(lifecycle()).getByRole('button', { name: 'Schedule key deletion' });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(PAGE.findModal()).toBeNull();
    expect(opener).toHaveAttribute('aria-disabled', 'true');
    expect(opener).toHaveAccessibleDescription('Not implemented by the emulator (ScheduleKeyDeletion)');
    expect(flashText('info')).toContain('ScheduleKeyDeletion');
    expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(1);
  });

  it('names EnableKey when it is not implemented and keeps enabling on the page as unavailable', async () => {
    const emulator = emulate(key('Disabled'), (command) => {
      if (command instanceof EnableKeyCommand) throw NOT_IMPLEMENTED;
      return undefined;
    });
    open();
    await expectActions(['Edit description', 'Enable key', 'Schedule key deletion']);

    action('Enable key');

    await waitFor(() => expect(flashText('info')).toContain('Not implemented by the emulator'));
    expect(flashText('info')).toContain('EnableKey');
    const enable = within(lifecycle()).getByRole('button', { name: 'Enable key' });
    expect(enable).toBeVisible();
    expect(usable(enable)).toBe(false);
    await expectActions(['Edit description', 'Schedule key deletion']);
    expect(sent(EnableKeyCommand)).toHaveLength(1);

    emulator.metadata = key('Disabled', { Description: 'Refreshed externally' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(field('Description')).toHaveTextContent('Refreshed externally'));
    await expectActions(['Edit description', 'Schedule key deletion']);
    const refreshedEnable = within(lifecycle()).getByRole('button', { name: 'Enable key' });
    expect(refreshedEnable).toBeVisible();
    expect(usable(refreshedEnable)).toBe(false);
    expect(flashText('info')).toContain('Not implemented by the emulator');
    expect(flashText('info')).toContain('EnableKey');
    action('Enable key');
    expect(sent(EnableKeyCommand)).toHaveLength(1);

    await opened('Schedule key deletion');
    emulator.metadata = key('PendingDeletion', { DeletionDate: deletionDate });
    confirm('Schedule deletion');

    await expectStatus('PendingDeletion');
    await expectActions(['Cancel key deletion']);
    expect(flashText()).toContain('Key deletion scheduled.');
    await waitFor(() => expect(flashText('info')).toBe(''));
    const retainedEnable = within(lifecycle()).getByRole('button', { name: 'Enable key' });
    expect(retainedEnable).toBeVisible();
    expect(usable(retainedEnable)).toBe(false);
    expect(retainedEnable).toHaveAccessibleDescription('Not implemented by the emulator (EnableKey)');
    fireEvent.click(retainedEnable);
    expect(sent(EnableKeyCommand)).toHaveLength(1);
    expect(sent(ScheduleKeyDeletionCommand)).toHaveLength(1);
  });
});
