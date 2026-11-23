import createWrapper from '@cloudscape-design/components/test-utils/dom';
import type ModalWrapper from '@cloudscape-design/components/test-utils/dom/modal';
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import AwsArea from '../../../../index';
import { secretPath } from '../../paths';
import { useSecretListing } from '../../queries';

export const NAME = 'dev/key';
export const REFUSAL = 'The emulator refused this change.';
const LIST = 'ListSecrets';
const DETAIL = 'DescribeSecret';

type Input = Record<string, unknown>;
type Reply = { body: unknown; status?: number };
type Handler = (operation: string, input: Input) => Reply | Promise<Reply> | undefined;
type Metadata = Record<string, unknown>;

let port = 8950;
export const page = createWrapper(document.body);

export function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing ${label}`);
  return value;
}

export function denied(message = REFUSAL): Reply {
  return { body: { __type: 'AccessDeniedException', message }, status: 403 };
}

export function buttons(scope = page) {
  return scope.findAllButtons().map((button) => ({
    button,
    name: button.getElement().getAttribute('aria-label') || button.findTextRegion()?.getElement().textContent?.trim(),
  }));
}

export function buttonNamed(name: string, scope = page) {
  return required(buttons(scope).find((entry) => entry.name === name)?.button, `button "${name}"`);
}

export async function click(name: string) {
  (await waitFor(() => buttonNamed(name))).click();
}

export function dialogNamed(title: string) {
  return waitFor(() =>
    required(
      page.findAllModals().find((modal) => modal.findHeader().getElement().textContent?.trim() === title),
      `dialog "${title}"`,
    ),
  );
}

export function dialogButton(dialog: ModalWrapper, name: string) {
  return buttonNamed(name, createWrapper(required(dialog.findFooter(), 'dialog footer').getElement()));
}

export function dialogInput(dialog: ModalWrapper, label: string) {
  const field = required(
    createWrapper(dialog.findContent().getElement())
      .findAllFormFields()
      .find((item) => item.findLabel()?.getElement().textContent?.trim() === label),
    `field "${label}"`,
  );
  const control = required(field.findControl(), `control for "${label}"`);
  return required(createWrapper(control.getElement()).findInput(), `input for "${label}"`);
}

export function dialogAlert(dialog: ModalWrapper) {
  return required(createWrapper(dialog.findContent().getElement()).findAlert(), 'dialog alert');
}

export function expectDialogAlert(dialog: ModalWrapper, message: string) {
  const content = required(dialogAlert(dialog).findContent(), 'dialog alert content').getElement();
  expect(within(content).getByText(message)).toBeVisible();
}

export function tableNamed(title: string) {
  return required(
    page.findAllTables().find((table) => {
      const slot = table.findHeaderSlot();
      return (
        slot &&
        createWrapper(slot.getElement()).findHeader()?.findHeadingText().getElement().textContent?.trim() === title
      );
    }),
    `table "${title}"`,
  );
}

export function findRow(title: string, label: string) {
  const table = tableNamed(title);
  return table.findRows().find((_, index) => {
    const identity = required(table.findBodyCell(index + 1, 1), 'row identity cell');
    return within(identity.getElement()).queryByText(label) !== null;
  });
}

export function flashContents() {
  return (
    page
      .findFlashbar()
      ?.findItems()
      .map((item) => item.findContent()?.getElement().textContent?.trim()) ?? []
  );
}

export function expectSuccess(message: string) {
  const flash = page
    .findFlashbar()
    ?.findItemsByType('success')
    .find((item) => item.findContent()?.getElement().textContent?.trim() === message);
  expect(required(flash, `success flash "${message}"`).getElement()).toBeVisible();
}

function ActiveReads({ connection }: { connection: AreaConnection }) {
  useSecretListing(connection, false);
  const list = useIsFetching({ queryKey: ['aws', 'secretsmanager', LIST] });
  const detail = useIsFetching({ queryKey: ['aws', 'secretsmanager', DETAIL] });
  return (
    <>
      <output aria-label={LIST} aria-busy={list > 0} />
      <output aria-label={DETAIL} aria-busy={detail > 0} />
    </>
  );
}

export function openSecret({
  metadata = {},
  handler,
  observe = false,
  compact = false,
}: { metadata?: Metadata; handler?: Handler; observe?: boolean; compact?: boolean } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(port++)}`,
    result: { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' } },
  };
  const calls = vi.fn<(operation: string, input: Input) => void>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: compact && media === '(width < 688px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    const body = (await request.json()) as Input;
    calls(operation, body);
    const reply = await handler?.(operation, body);
    if (reply !== undefined) return answer(reply.body, reply.status);
    if (operation === DETAIL) return answer({ Name: NAME, ...metadata });
    if (operation === LIST) return answer({ SecretList: [{ Name: NAME }] });
    throw new Error(`Unexpected operation ${operation}`);
  });

  function Frame() {
    return (
      <>
        {observe && <ActiveReads connection={connection} />}
        <AwsArea
          headerSelector="#top-bar"
          connection={connection}
          targetGeneration={0}
          routeChanges={0}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </>
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [secretPath(NAME)] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls };
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const ORDERS = ['list first', 'detail first'] as const;

export function delayedRefresh(operation: string, metadata: Metadata) {
  const reads = {
    [LIST]: { ...deferredReply(), body: { SecretList: [{ Name: NAME }] } },
    [DETAIL]: { ...deferredReply(), body: { Name: NAME, ...metadata } },
  };
  let written = false;
  const handler: Handler = (called) => {
    if (called === operation) {
      written = true;
      return { body: { Name: NAME } };
    }
    if (written && (called === LIST || called === DETAIL)) return reads[called].promise;
  };

  async function complete(order: (typeof ORDERS)[number], success: string, assertDetail: () => void) {
    await waitFor(() => {
      for (const read of [LIST, DETAIL]) expect(screen.getByLabelText(read)).toHaveAttribute('aria-busy', 'true');
    });
    expectSuccess(success);
    const ordered = order === 'list first' ? ([LIST, DETAIL] as const) : ([DETAIL, LIST] as const);
    for (const read of ordered) {
      reads[read].resolve({ body: reads[read].body });
      await waitFor(() => expect(screen.getByLabelText(read)).toHaveAttribute('aria-busy', 'false'));
      expectSuccess(success);
      if (read === DETAIL) await waitFor(assertDetail);
    }
    assertDetail();
  }

  return { handler, complete };
}
