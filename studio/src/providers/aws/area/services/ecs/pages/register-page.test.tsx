import type { TaskDefinition } from '@aws-sdk/client-ecs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as definitions from '../definition-api';
import { ECS_KEYS } from '../queries';
import * as api from '../register-api';
import { documentOf, STARTER } from '../register-form';

// Test criteria, "Unit s7 — services/ecs/pages/register-page.test.tsx" (issue 575). S10 rendered inside the area's
// layout, with the calls of `register-api.ts` and `definition-api.ts` answered by the case (their own tests prove the
// calls against a fake engine). The new revision's page (S9) is the area's own, so the flash is read where it lands.

vi.mock('../register-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../register-api')>();
  return { ...real, registerTaskDefinition: vi.fn() };
});

vi.mock('../definition-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../definition-api')>();
  return { ...real, getRevision: vi.fn(), listFamilies: vi.fn(), listRevisions: vi.fn() };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;
}

const EMULATOR = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8313';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

const REGISTER_PATH = '/aws/ecs/task-definitions/register';

function open(path = REGISTER_PATH) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const FIELD_DESCRIPTION =
  "The emulator plays a task from its containers' command: what it echoes becomes the task's log, and a sleep keeps the task running.";
const PAGE_DESCRIPTION =
  'A task definition is registered from its JSON, the same document aws ecs register-task-definition --cli-input-json takes. A family that exists gets a new revision.';

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field() {
  const found = PAGE.findAllFormFields().find(
    (each) => text(each.findLabel()?.getElement()) === 'Task definition JSON',
  );
  if (found === undefined) {
    throw new Error('no field Task definition JSON');
  }
  return found;
}

/** The field's text box, found by its label without Cloudscape's wrappers, which mark the DOM as they search. */
function textarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Task definition JSON' });
}

function type(value: string) {
  fireEvent.change(textarea(), { target: { value } });
}

const errorText = () => text(field().findError()?.getElement());
const registerButton = () => screen.getByRole('button', { name: 'Register' });

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Register task definition' })).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(textarea()).toBeInTheDocument();
  });
}

/** A described revision of `family`, number `revision`. */
function answerOf(family: string, revision: number): TaskDefinition {
  return {
    taskDefinitionArn: `arn:aws:ecs:us-east-1:000000000000:task-definition/${family}:${String(revision)}`,
    family,
    revision,
    status: 'ACTIVE',
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    compatibilities: ['EC2', 'FARGATE'],
    cpu: '256',
    memory: '512',
    containerDefinitions: [{ name: 'web', image: 'nginx', essential: true }],
    registeredAt: new Date('2026-11-20T05:00:00Z'),
  };
}

function readOf(family: string, revision: number): definitions.RevisionRead {
  const answer = answerOf(family, revision);
  return {
    found: true,
    revision: {
      family,
      revision,
      arn: answer.taskDefinitionArn ?? '',
      status: 'ACTIVE',
      networkMode: 'awsvpc',
      compatibilities: ['EC2', 'FARGATE'],
      cpu: '256',
      memory: '512',
      containers: [{ name: 'web', image: 'nginx', essential: true, ports: [] }],
      answer,
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  vi.mocked(definitions.getRevision).mockImplementation((_at, family, revision) =>
    Promise.resolve(readOf(family, revision)),
  );
  vi.mocked(definitions.listFamilies).mockResolvedValue({ items: [] });
  vi.mocked(definitions.listRevisions).mockResolvedValue({ items: [] });
  vi.mocked(api.registerTaskDefinition).mockResolvedValue({ family: 'studio-task', revision: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FLASH = 'Task definition web:4 registered.';
const REFUSAL = new RequestError({
  kind: 'other',
  operation: 'RegisterTaskDefinition',
  code: 'ClientException',
  message: 'Container.image should not be null or empty.',
});

describe('Register task definition', () => {
  it('without from → the field holds the starter, with the description of R4', async () => {
    open();
    await opened();
    expect(textarea().value).toBe(STARTER);
    expect(text(field().findDescription()?.getElement())).toBe(FIELD_DESCRIPTION);
    expect(text(document.body)).toContain(PAGE_DESCRIPTION);
    expect(definitions.getRevision).not.toHaveBeenCalled();
  });

  it("with from of a revision that is read → the field holds that revision's members", async () => {
    open(`${REGISTER_PATH}?from=web%3A3`);
    await opened();
    await waitFor(() => {
      expect(textarea().value).toBe(documentOf(answerOf('web', 3)));
    });
    expect(vi.mocked(definitions.getRevision).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'web', 3]);
    expect(definitions.getRevision).toHaveBeenCalledTimes(1);
    expect(textarea().value).not.toContain('taskDefinitionArn');
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  for (const [what, setup] of [
    ['not found', () => vi.mocked(definitions.getRevision).mockResolvedValue({ found: false })],
    [
      'refused',
      () =>
        vi
          .mocked(definitions.getRevision)
          .mockRejectedValue(
            new RequestError({ kind: 'other', operation: 'DescribeTaskDefinition', code: 'ServerException' }),
          ),
    ],
  ] as const) {
    it(`with from of a revision that cannot be read (${what}) → the starter and the warning`, async () => {
      setup();
      open(`${REGISTER_PATH}?from=web%3A9`);
      expect(
        await screen.findByText('Revision web:9 could not be read; the starter is shown instead.'),
      ).toBeInTheDocument();
      expect(textarea().value).toBe(STARTER);
    });
  }

  it('"Register" with text that is not JSON → its message at the field, nothing sent', async () => {
    open();
    await opened();
    type('{"family": ');
    fireEvent.click(registerButton());
    expect(errorText()).toMatch(/^This is not valid JSON: /);
    type('[]');
    fireEvent.click(registerButton());
    expect(errorText()).toBe('A task definition is a JSON object.');
    expect(api.registerTaskDefinition).not.toHaveBeenCalled();
  });

  it('"Register" answered → the revision\'s page of the answer\'s family and revision, with the flash', async () => {
    vi.mocked(api.registerTaskDefinition).mockResolvedValue({ family: 'web', revision: 4 });
    const { router } = open();
    await opened();
    fireEvent.click(registerButton());
    expect(await screen.findByText(FLASH)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web/revision/4');
    expect(vi.mocked(api.registerTaskDefinition).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      JSON.parse(STARTER) as unknown,
    ]);
  });

  for (const order of ['the earlier read first', 'the new read first'] as const) {
    it(`(order) a not-found held and a read still out of the new revision, ${order} → the flash, never "No revision", then the revision`, async () => {
      const { router, client } = open();
      await opened();
      // Held from before: the new revision's page opened by its address earlier, and a read of it still out.
      client.setQueryData([...ECS_KEYS.revision('web', 4), ENGINE, 990, 0], { found: false });
      const earlier = deferred<definitions.RevisionRead>();
      void client
        .fetchQuery({ queryKey: [...ECS_KEYS.revision('web', 4), ENGINE, 991, 0], queryFn: () => earlier.promise })
        .catch(() => undefined);
      const fresh = deferred<definitions.RevisionRead>();
      vi.mocked(definitions.getRevision).mockImplementation(() => fresh.promise);
      vi.mocked(api.registerTaskDefinition).mockResolvedValue({ family: 'web', revision: 4 });

      fireEvent.click(registerButton());
      expect(await screen.findByText(FLASH)).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web/revision/4');
      expect(screen.queryByText('No revision web:4')).not.toBeInTheDocument();

      if (order === 'the earlier read first') {
        await act(async () => {
          earlier.resolve({ found: false });
          await Promise.resolve();
        });
        expect(screen.queryByText('No revision web:4')).not.toBeInTheDocument();
        await act(async () => {
          fresh.resolve(readOf('web', 4));
          await Promise.resolve();
        });
      } else {
        await act(async () => {
          fresh.resolve(readOf('web', 4));
          await Promise.resolve();
        });
        expect(await screen.findByText('Task definition details')).toBeInTheDocument();
        await act(async () => {
          earlier.resolve({ found: false });
          await Promise.resolve();
        });
      }
      expect(await screen.findByText('Task definition details')).toBeInTheDocument();
      expect(screen.queryByText('No revision web:4')).not.toBeInTheDocument();
      expect(screen.getByText(FLASH)).toBeInTheDocument();
    });
  }

  it('a refusal → the form stays with its message and the code and message at the field, the text kept', async () => {
    vi.mocked(api.registerTaskDefinition).mockRejectedValue(REFUSAL);
    const { router } = open();
    await opened();
    type('{"family": "web", "containerDefinitions": [{"name": "app"}]}');
    fireEvent.click(registerButton());
    // Cloudscape's wrappers mark the DOM as they search it, so the field's error is read once it is shown.
    expect(
      await screen.findByText('Container.image should not be null or empty.', { exact: false }),
    ).toBeInTheDocument();
    expect(errorText()).toBe(
      'The emulator did not register the task definition. ClientException: Container.image should not be null or empty.',
    );
    expect(router.state.location.pathname).toBe(REGISTER_PATH);
    expect(textarea().value).toBe('{"family": "web", "containerDefinitions": [{"name": "app"}]}');
  });

  it('while the request is out → "Register" is disabled and a second press sends nothing', async () => {
    const answer = deferred<api.Registered>();
    vi.mocked(api.registerTaskDefinition).mockImplementation(() => answer.promise);
    const { router } = open();
    await opened();
    fireEvent.click(registerButton());
    await waitFor(() => {
      expect(api.registerTaskDefinition).toHaveBeenCalledTimes(1);
    });
    expect(isDisabled(registerButton())).toBe(true);
    expect(textarea().disabled).toBe(true);
    fireEvent.click(registerButton());
    fireEvent.submit(registerButton().closest('form') as HTMLFormElement);
    expect(api.registerTaskDefinition).toHaveBeenCalledTimes(1);
    act(() => {
      answer.resolve({ family: 'studio-task', revision: 1 });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/studio-task/revision/1');
    });
  });

  it('"Cancel" with the text as it started → leaves to the list', async () => {
    const first = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe('/aws/ecs/task-definitions');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" with from and the text as it started → that revision\'s page', async () => {
    const { router } = open(`${REGISTER_PATH}?from=web%3A3`);
    await opened();
    await waitFor(() => {
      expect(textarea().value).toBe(documentOf(answerOf('web', 3)));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web/revision/3');
    });
  });

  it('"Cancel" with the text changed → asks first; "Keep editing" keeps the text, "Discard" leaves', async () => {
    const { router } = open();
    await opened();
    type('{}');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(REGISTER_PATH);
    expect(textarea().value).toBe('{}');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions');
    });
    expect(api.registerTaskDefinition).not.toHaveBeenCalled();
  });

  it('the page names "task definitions" to the area\'s frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These task definitions are in your local emulator')).toBeInTheDocument();
  });
});
