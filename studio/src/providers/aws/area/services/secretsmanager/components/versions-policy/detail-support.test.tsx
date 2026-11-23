import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import AwsArea from '../../../../index';
import { secretPath } from '../../paths';
import { useSecretListing } from '../../queries';

export const NAME = 'dev/tracked';
export const REFUSAL = 'The emulator refused this change.';
export const CURRENT = 'version-current';
export const OLDER = 'version-older';

type Input = Record<string, unknown>;
type Reply = { body: unknown; status?: number };
type Handler = (operation: string, input: Input, request: Request) => Reply | Promise<Reply> | undefined;

let port = 8850;

export function denied(message = REFUSAL) {
  return { body: { __type: 'AccessDeniedException', message }, status: 403 };
}

export function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

export function openSecret({
  handler,
  stages = { [CURRENT]: ['AWSCURRENT'], [OLDER]: [] },
  observe,
}: { handler?: Handler; stages?: Record<string, string[]>; observe?: readonly string[] } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(port++)}`,
    result: { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' } },
  };
  const calls = vi.fn<(operation: string, input: Input) => void>();
  const metadata = { Name: NAME, VersionIdsToStages: stages };
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
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
    const reply = await handler?.(operation, body, request);
    if (reply !== undefined) return answer(reply.body, reply.status);
    switch (operation) {
      case 'ListSecrets':
        return answer({ SecretList: [metadata] });
      case 'DescribeSecret':
        return answer(metadata);
      case 'ListSecretVersionIds':
        return answer({ Versions: versionRows(stages) });
      default:
        return answer({});
    }
  });

  function ActiveReads({ connection, operations }: { connection: AreaConnection; operations: readonly string[] }) {
    useSecretListing(connection, false);
    const list = useIsFetching({ queryKey: ['aws', 'secretsmanager', operations[0]] });
    const detail = useIsFetching({ queryKey: ['aws', 'secretsmanager', operations[1]] });
    const section = useIsFetching({ queryKey: ['aws', 'secretsmanager', operations[2]] });
    return (
      <>
        <output aria-label={operations[0]} aria-busy={list > 0} />
        <output aria-label={operations[1]} aria-busy={detail > 0} />
        <output aria-label={operations[2]} aria-busy={section > 0} />
      </>
    );
  }

  function Frame() {
    return (
      <>
        {observe !== undefined && <ActiveReads connection={connection} operations={observe} />}
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
  return {
    calls,
    waitForRead: (operation: string, fetching: boolean) =>
      waitFor(() => expect(client.isFetching({ queryKey: ['aws', 'secretsmanager', operation] }) > 0).toBe(fetching)),
  };
}

export function versionRows(stages: Record<string, string[]>) {
  return Object.entries(stages).map(([VersionId, VersionStages]) => ({ VersionId, VersionStages }));
}

export async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

export const page = () => createWrapper(document.body);

export function required<T>(element: T | undefined | null, description: string): T {
  if (element == null) throw new Error(`Missing ${description}`);
  return element;
}

export function findSection(name: string) {
  return page()
    .findAllExpandableSections()
    .find((entry) => entry.findHeaderText()?.getElement().textContent === name);
}

export async function section(name: string) {
  return waitFor(() => required(findSection(name), name));
}

export async function findDialog(name: string) {
  return waitFor(() =>
    required(
      page()
        .findAllModals()
        .find((modal) => modal.isVisible() && modal.findHeader().getElement().textContent === name),
      name,
    ),
  );
}

type Dialog = Awaited<ReturnType<typeof findDialog>>;

export function dialogButton(dialog: Dialog, name: string) {
  const footer = required(dialog.findFooter(), 'dialog footer');
  return required(
    createWrapper(footer.getElement())
      .findAllButtons()
      .find((button) => button.findTextRegion()?.getElement().textContent === name),
    name,
  );
}

export function press(dialog: Dialog, name: string) {
  fireEvent.click(dialogButton(dialog, name).getElement());
}

export function dialogContent(dialog: Dialog) {
  return createWrapper(dialog.findContent().getElement());
}

export async function expectAlert(container: ReturnType<typeof page>, message: string) {
  await waitFor(() =>
    expect(
      container
        .findAllAlerts()
        .find((alert) => alert.findContent().getElement().textContent?.includes(message))
        ?.findContent()
        .getElement(),
    ).toBeVisible(),
  );
}

export function successFlashes() {
  return (
    page()
      .findFlashbar()
      ?.findItemsByType('success')
      .map((item) => item.findContent()?.getElement()) ?? []
  );
}

export const ORDERS = ['list first', 'section first'] as const;

export function delayedRefresh(
  write: string,
  section: string,
  newStages: Record<string, string[]>,
  sectionReply: Reply,
) {
  const operations = ['ListSecrets', 'DescribeSecret', section] as const;
  const replies = [
    { body: { SecretList: [{ Name: NAME, SecretVersionsToStages: newStages }] } },
    { body: { Name: NAME, VersionIdsToStages: newStages } },
    sectionReply,
  ] as const;
  const deferred = [deferredReply(), deferredReply(), deferredReply()] as const;
  let written = false;
  const handler: Handler = (called) => {
    if (called === write) {
      written = true;
      return { body: { Name: NAME } };
    }
    if (!written) return undefined;
    const index = operations.findIndex((operation) => operation === called);
    return deferred[index]?.promise;
  };

  async function complete(order: (typeof ORDERS)[number], success: string) {
    await waitFor(() => {
      for (const operation of operations) expect(screen.getByLabelText(operation)).toHaveAttribute('aria-busy', 'true');
    });
    const indexes = order === 'list first' ? ([0, 1, 2] as const) : ([2, 1, 0] as const);
    for (const index of indexes) {
      await act(() => deferred[index].resolve(replies[index]));
      await waitFor(() => expect(screen.getByLabelText(operations[index])).toHaveAttribute('aria-busy', 'false'));
      const result = successFlashes().find((content) => content?.textContent === success);
      expect(result).toBeVisible();
    }
  }
  return { operations, handler, complete };
}

export function refusalReread(operation: string, read: string, original: Reply) {
  const followUp = deferredReply();
  let refused = false;
  const handler: Handler = (called) => {
    if (called === operation) {
      refused = true;
      return denied();
    }
    if (called === read) return refused ? followUp.promise : original;
  };
  async function complete(subject: ReturnType<typeof openSecret>) {
    await waitFor(() => expect(subject.calls.mock.calls.filter(([called]) => called === read)).toHaveLength(2));
    await subject.waitForRead(read, true);
    await act(() => followUp.resolve(original));
    await subject.waitForRead(read, false);
    expect(successFlashes()).toHaveLength(0);
  }
  return { handler, complete };
}
