import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { keyPath, KEYS_PATH } from '../paths';
import { KEY_CREATE_PATH } from './create';

const KEY_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const DESCRIPTION = 'Local payments key';
const PAGE = createWrapper(document.body);
let nextPort = 8760;

type Reply = { body: unknown; status?: number };
type Handler = (operation: string) => Reply | Promise<Reply> | undefined;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => vi.unstubAllGlobals());

const DEFAULT_REPLIES: Record<string, unknown> = {
  ListKeys: { Keys: [], Truncated: false },
  ListAliases: { Aliases: [], Truncated: false },
  ListResourceTags: { Tags: [], Truncated: false },
};

function metadata() {
  return {
    KeyMetadata: {
      KeyId: KEY_ID,
      Arn: `arn:aws:kms:us-east-1:000000000000:key/${KEY_ID}`,
      KeyManager: 'CUSTOMER',
      KeyState: 'Enabled',
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Origin: 'AWS_KMS',
      Description: '',
      CreationDate: 1_795_000_000,
    },
  };
}

function openCreate(handler?: Handler) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(nextPort++)}`,
    result: { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9320, endpoint: 'https://127.0.0.1:9320' } },
  };
  const calls = vi.fn<(operation: string, body: unknown) => void>();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
    if (new URL(request.url).pathname === '/__emuforge/session') return reply({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    calls(operation, await request.json());
    const answer = await handler?.(operation);
    if (answer) return reply(answer.body, answer.status);
    return reply(DEFAULT_REPLIES[operation] ?? {});
  });
  function Frame() {
    const { pathname } = useLocation();
    const [visit, setVisit] = useState({ pathname, count: 0 });
    const latest = pathname === visit.pathname ? visit : { pathname, count: visit.count + 1 };
    if (latest !== visit) setVisit(latest);
    return (
      <AwsArea
        headerSelector="#top-bar"
        connection={connection}
        targetGeneration={0}
        routeChanges={latest.count}
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [KEY_CREATE_PATH] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    calls,
    count: (operation: string) => calls.mock.calls.filter(([name]) => name === operation).length,
    router,
  };
}

function descriptionField() {
  const field = PAGE.findAllFormFields().find((item) => item.findLabel()?.getElement().textContent === 'Description');
  const control = field?.findControl()?.findTextarea()?.findNativeTextarea();
  if (!control) throw new Error('Missing description field');
  return control.getElement();
}

function enterDescription(value: string) {
  fireEvent.change(descriptionField(), { target: { value } });
}

async function click(name: string) {
  const control = await waitFor(() => {
    const modal = screen.queryByRole('dialog');
    return within(modal ?? document.body).getByRole('button', { name });
  });
  fireEvent.click(control);
}

async function expectList(router: ReturnType<typeof openCreate>['router']) {
  await screen.findByRole('heading', { name: 'Customer managed keys', level: 1 });
  expect(router.state.location.pathname).toBe(KEYS_PATH);
}

function area() {
  return PAGE.findAppLayout()?.findContentRegion();
}

function successText() {
  return (
    area()
      ?.findFlashbar()
      ?.findItemsByType('success')
      .map((item) => item.findContent()?.getElement().textContent) ?? []
  );
}

function expectField(label: string, value: string) {
  const term = screen.getByText(label, { selector: 'dt *, dt' }).closest('dt');
  expect(term?.nextElementSibling).toHaveTextContent(value);
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe('Create key', () => {
  it('opens the returned key with Key created. when its alias read answers before its metadata', async () => {
    const detail = deferredReply();
    let aliasesRead = false;
    const { calls, count, router } = openCreate((operation) => {
      if (operation === 'CreateKey') return { body: metadata() };
      if (operation === 'DescribeKey') return detail.promise;
      if (operation === 'ListAliases') {
        aliasesRead = true;
        return undefined;
      }
    });
    await screen.findByRole('heading', { name: 'Create key', level: 1 });

    await click('Create key');

    await waitFor(() => expect(router.state.location.pathname).toBe(keyPath(KEY_ID)));
    await waitFor(() => expect(aliasesRead).toBe(true));
    await waitFor(() => expect(successText()).toEqual(['Key created.']));
    expect(screen.queryByRole('heading', { name: 'Key metadata' })).toBeNull();

    await act(async () => {
      detail.resolve({ body: metadata() });
    });

    await screen.findByRole('heading', { name: 'Key metadata' });
    expectField('Key ID', KEY_ID);
    expectField('Status', 'Enabled');
    expect(successText()).toEqual(['Key created.']);
    expect(count('CreateKey')).toBe(1);
    expect(calls).toHaveBeenCalledWith('CreateKey', {
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Origin: 'AWS_KMS',
      MultiRegion: false,
    });
    expect(calls).toHaveBeenCalledWith('DescribeKey', { KeyId: KEY_ID });
  });

  it('keeps the description and shows the reason when creation is refused', async () => {
    const reason = 'The description is not accepted by the local emulator.';
    const { router, count } = openCreate((operation) =>
      operation === 'CreateKey' ? { body: { __type: 'ValidationException', message: reason }, status: 400 } : undefined,
    );
    await screen.findByRole('heading', { name: 'Create key', level: 1 });
    enterDescription(DESCRIPTION);

    await click('Create key');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Key creation failed');
    expect(alert).toHaveTextContent('ValidationException');
    expect(alert).toHaveTextContent(reason);
    expect(descriptionField()).toHaveValue(DESCRIPTION);
    expect(router.state.location.pathname).toBe(KEY_CREATE_PATH);
    expect(count('CreateKey')).toBe(1);
    expect(successText()).toEqual([]);
  });

  it('returns to the key list without creating a key when an untouched form is canceled', async () => {
    const { router, count } = openCreate();
    await screen.findByRole('heading', { name: 'Create key', level: 1 });

    await click('Cancel');

    await expectList(router);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(count('CreateKey')).toBe(0);
  });

  it('asks before discarding an edited form, keeps it on Keep editing and leaves on Discard', async () => {
    const { router, count } = openCreate();
    await screen.findByRole('heading', { name: 'Create key', level: 1 });
    enterDescription(DESCRIPTION);

    await click('Cancel');
    await screen.findByRole('dialog');
    await click('Keep editing');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(descriptionField()).toHaveValue(DESCRIPTION);
    expect(router.state.location.pathname).toBe(KEY_CREATE_PATH);

    await click('Cancel');
    await screen.findByRole('dialog');
    await click('Discard');

    await expectList(router);
    expect(count('CreateKey')).toBe(0);
  });
});
