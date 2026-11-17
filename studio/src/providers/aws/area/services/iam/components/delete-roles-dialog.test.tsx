import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// The dialog "Delete … roles?" of the role list, opened from the list inside the area's layout, as Studio's frame
// renders the area, against a fake engine behind the page's `fetch` (test-criteria.md, issue 82, "Unit —
// services/iam/components/delete-roles-dialog.test.tsx"; requirement R7, R10.3).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the roles it holds.
// ---------------------------------------------------------------------------------------------------------------

interface FakeRole {
  name: string;
  path?: string;
  /** The trust policy as JSON; percent-encoded in the answer, as the emulator sends it. */
  trust?: string;
  /** `RoleLastUsed.LastUsedDate` of `GetRole`. */
  lastUsed?: string;
}

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

interface Sent {
  action: string;
  params: URLSearchParams;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ok(action: string, result: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${esc(code)}</Code><Message>${esc(message)}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
  };
}

/** A refusal of the engine's own (`EmulatorUnavailable`, `EmulatorTimeout`), in the shape the engine writes. */
function engineRefusal(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0"?><ErrorResponse><Error><Type>Receiver</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error></ErrorResponse>`,
  };
}

const LAMBDA_TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

function serviceTrust(principal: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: principal }, Action: 'sts:AssumeRole' }],
  });
}

function roleXml({ name, path = '/', trust = LAMBDA_TRUST }: FakeRole): string {
  return `<Path>${esc(path)}</Path><RoleName>${esc(name)}</RoleName><RoleId>AROA${String(name.length)}</RoleId><Arn>arn:aws:iam::000000000000:role${esc(path)}${esc(name)}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><AssumeRolePolicyDocument>${esc(encodeURIComponent(trust))}</AssumeRolePolicyDocument><MaxSessionDuration>3600</MaxSessionDuration>`;
}

class FakeEngine {
  /** The roles the emulator holds, in its order. */
  roles: FakeRole[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};
  private sessions = 0;

  /** The emulator's answer: `ListRoles` with `MaxItems` and a marker that is the index of the next role. */
  emulator(action: string, params: URLSearchParams): Answer {
    switch (action) {
      case 'ListRoles': {
        const size = Number(params.get('MaxItems') ?? '100');
        const from = Number(params.get('Marker') ?? '0');
        const page = this.roles.slice(from, from + size);
        const next = from + size < this.roles.length ? String(from + size) : undefined;
        return ok(
          action,
          `<Roles>${page.map((role) => `<member>${roleXml(role)}</member>`).join('')}</Roles>${
            next === undefined
              ? '<IsTruncated>false</IsTruncated>'
              : `<IsTruncated>true</IsTruncated><Marker>${next}</Marker>`
          }`,
        );
      }
      case 'GetRole': {
        const role = this.roles.find((held) => held.name === params.get('RoleName'));
        if (role === undefined) {
          return errorAnswer(404, 'NoSuchEntity', 'The role cannot be found.');
        }
        const used =
          role.lastUsed === undefined
            ? '<RoleLastUsed/>'
            : `<RoleLastUsed><LastUsedDate>${role.lastUsed}</LastUsedDate></RoleLastUsed>`;
        return ok(action, `<Role>${roleXml(role)}${used}</Role>`);
      }
      case 'DeleteRole':
      case 'DeleteServiceLinkedRole':
        this.roles = this.roles.filter((role) => role.name !== params.get('RoleName'));
        return ok(action, action === 'DeleteServiceLinkedRole' ? '<DeletionTaskId>task/1</DeletionTaskId>' : '');
      case 'ListInstanceProfilesForRole':
        return ok(action, '<InstanceProfiles/><IsTruncated>false</IsTruncated>');
      case 'ListAttachedRolePolicies':
        return ok(action, '<AttachedPolicies/><IsTruncated>false</IsTruncated>');
      case 'ListRolePolicies':
        return ok(action, '<PolicyNames/><IsTruncated>false</IsTruncated>');
      default:
        return ok(action, '');
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      this.sessions += 1;
      return new Response(JSON.stringify({ token: `token-${String(this.sessions)}` }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    this.sent.push({ action, params });
    const handler = this.handlers[action];
    const answer = await Promise.race([
      Promise.resolve(handler === undefined ? this.emulator(action, params) : handler(params)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };

  of(action: string): Sent[] {
    return this.sent.filter((sent) => sent.action === action);
  }

  get lists(): Sent[] {
    return this.of('ListRoles');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

/** The connection Studio hands the area, as a case sets it; each change re-renders the area as the frame does. */
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

  set(result: CheckResult | undefined) {
    this.value = { ...this.value, result };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const EMULATOR_PORT = 9313;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

function notStartedResult(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
    reason: 'not_started',
    message: '',
  };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9050;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;

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
      // The document title as Studio's frame makes it from the title the area reports (studio/AGENTS.md).
      onPageTitle={(title) => {
        document.title = `${title} | EmuForge Studio`;
      }}
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

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  engineOrigin = engineEndpoint(nextPort);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin };
  document.title = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(path = '/aws/iam/roles') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router, client };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers and steps.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

function tableElement(): HTMLElement {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return (found as NonNullable<typeof found>).getElement();
}

function listNames(): string[] {
  return (PAGE.findTable()?.findRows() ?? []).map((row) =>
    (row.getElement().querySelector('th')?.textContent ?? '').trim(),
  );
}

async function expectListNames(expected: string[]) {
  await waitFor(() => {
    expect(listNames()).toEqual(expected);
  });
}

/** The list's "Delete", which opens the dialog. */
function listDelete(): HTMLElement {
  return within(tableElement()).getByRole('button', { name: 'Delete' });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason or while loading by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** Opens the list holding `roles`, selects `selected` by their check boxes and presses "Delete". */
async function openDialog(roles: FakeRole[], selected: string[] = roles.map((role) => role.name)) {
  engine.roles = roles;
  const opened = open();
  await expectListNames(roles.map((role) => role.name));
  for (const name of selected) {
    fireEvent.click(screen.getByRole('checkbox', { name }));
  }
  fireEvent.click(listDelete());
  const dialog = await screen.findByRole('dialog', {
    name: selected.length === 1 ? 'Delete 1 role?' : `Delete ${String(selected.length)} roles?`,
  });
  return { ...opened, dialog };
}

function field(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByLabelText('To confirm, type delete');
}

function confirmButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: 'Delete' });
}

function typeWord(dialog: HTMLElement, word: string) {
  fireEvent.change(field(dialog), { target: { value: word } });
}

/** Types `delete` and presses the dialog's "Delete". */
function confirmDelete(dialog: HTMLElement) {
  typeWord(dialog, 'delete');
  fireEvent.click(confirmButton(dialog));
}

async function expectClosed(when = 'the dialog closes') {
  await waitFor(() => {
    expect(screen.queryByRole('dialog'), when).toBeNull();
  });
}

/** The Flashbar's items: type and text. */
function flashItems(): { type: string; text: string }[] {
  const flashbar = PAGE.findFlashbar();
  if (flashbar === null) {
    return [];
  }
  return (['success', 'error', 'info', 'warning'] as const)
    .flatMap((type) =>
      flashbar.findItemsByType(type).map((item) => ({
        element: item.getElement(),
        type,
        text: [item.findHeader(), item.findContent()]
          .map((part) => (part?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter((part) => part !== '')
          .join(' '),
      })),
    )
    .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map(({ type, text }) => ({ type, text }));
}

/** The actions sent from `from` on, each with its role. */
function sentSince(from: number): string[] {
  return engine.sent.slice(from).map(({ action, params }) => `${action} ${params.get('RoleName') ?? ''}`.trim());
}

const PLAIN_STEPS = (name: string) => [
  `ListInstanceProfilesForRole ${name}`,
  `ListAttachedRolePolicies ${name}`,
  `ListRolePolicies ${name}`,
  `DeleteRole ${name}`,
];

const LINKED: FakeRole = {
  name: 'AWSServiceRoleForThing',
  path: '/aws-service-role/thing.amazonaws.com/',
  trust: serviceTrust('thing.amazonaws.com'),
};

const THREE: FakeRole[] = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];

// ---------------------------------------------------------------------------------------------------------------

describe('the dialog', () => {
  it('one role: "Delete 1 role?"; three: "Delete 3 roles?", the table in the order given with the rows’ values, the sentence, the field, the buttons, no "Learn more"', async () => {
    const used = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 60_000).toISOString();
    const first = await openDialog([{ name: 'solo', lastUsed: used }]);
    const soloRows = within(first.dialog).getAllByRole('row').slice(1);
    expect(soloRows.map((row) => [...row.querySelectorAll('td, th')].map((cell) => cell.textContent))).toEqual([
      ['solo', '2 days ago'],
    ]);
    first.unmount();

    const { dialog } = await openDialog(
      [{ name: 'gamma' }, { name: 'alpha' }, { name: 'beta' }],
      ['beta', 'gamma', 'alpha'],
    );
    const headings = within(dialog)
      .getAllByRole('columnheader')
      .map((cell) => (cell.textContent ?? '').trim());
    expect(headings).toEqual(['Role name', 'Last activity']);
    const rows = within(dialog).getAllByRole('row').slice(1);
    // The order of the list's rows, whatever the order of selection.
    expect(rows.map((row) => row.querySelector('th, td')?.textContent)).toEqual(['gamma', 'alpha', 'beta']);
    expect(rows.map((row) => row.querySelectorAll('td, th')[1]?.textContent)).toEqual(['-', '-', '-']);
    expect(dialog).toHaveTextContent(
      `They will be deleted from your local emulator at ${EMULATOR_ENDPOINT}. A role's managed policies are detached, its inline policies are deleted and it is removed from its instance profiles first; a service-linked role is deleted by the emulator as a whole. This cannot be undone.`,
    );
    expect(field(dialog)).toHaveAttribute('placeholder', 'delete');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(confirmButton(dialog)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /Learn more/ })).toBeNull();
    expect(dialog).not.toHaveTextContent('Learn more');

    connection.set(notStartedResult());
    expect(dialog).toHaveTextContent(
      "They will be deleted from your local emulator. A role's managed policies are detached, its inline policies are deleted and it is removed from its instance profiles first; a service-linked role is deleted by the emulator as a whole. This cannot be undone.",
    );
    expect(dialog).not.toHaveTextContent(EMULATOR_ENDPOINT);
  });

  it.each(['', 'Delete', 'delete ', 'delet'])('the field holding "%s": "Delete" is disabled', async (word) => {
    const { dialog } = await openDialog([{ name: 'solo' }]);

    typeWord(dialog, 'x');
    typeWord(dialog, word);
    expect(isDisabled(confirmButton(dialog))).toBe(true);
  });

  it('the field holding exactly "delete": "Delete" is enabled; typing keeps the field, its focus and the dialog', async () => {
    const { dialog } = await openDialog([{ name: 'solo' }]);
    const input = field(dialog);
    act(() => {
      input.focus();
    });

    for (const typed of ['d', 'de', 'del', 'dele', 'delet', 'delete']) {
      typeWord(dialog, typed);
      await act(() => Promise.resolve());
    }
    expect(dialog.isConnected).toBe(true);
    expect(field(dialog)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(isDisabled(confirmButton(dialog))).toBe(false);
  });

  it('"Cancel" and Esc close it without a request, focus on the list’s "Delete"; while open, Tab stays inside', async () => {
    const { dialog } = await openDialog([{ name: 'solo' }]);
    const sent = engine.sent.length;

    // The focus trap: a Tab past the last control lands on Cloudscape's trap, which sends focus back inside.
    const traps = [...(dialog.closest('[role="dialog"]')?.parentElement?.querySelectorAll('[tabindex="0"]') ?? [])];
    const trap = traps.at(-1) as HTMLElement | undefined;
    expect(trap).toBeDefined();
    act(() => {
      trap?.focus();
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trap);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expectClosed('after Cancel');
    expect(engine.sent.length).toBe(sent);
    await waitFor(() => {
      expect(document.activeElement).toBe(listDelete());
    });

    fireEvent.click(listDelete());
    const again = await screen.findByRole('dialog', { name: 'Delete 1 role?' });
    // Esc where focus is, inside the dialog.
    fireEvent.keyDown(field(again), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await expectClosed('after Esc');
    expect(engine.sent.length).toBe(sent);
    await waitFor(() => {
      expect(document.activeElement).toBe(listDelete());
    });
  });
});

describe('deleting', () => {
  it('"Delete": the requests of R7 per role, in order; while in flight "Delete" is disabled and shows progress, and a second press sends nothing', async () => {
    const { dialog } = await openDialog([{ name: 'alpha' }, LINKED, { name: 'gamma' }]);
    const from = engine.sent.length;
    let release: () => void = () => undefined;
    engine.handlers.DeleteRole = (params) => {
      const answer = () => engine.emulator('DeleteRole', params);
      if (params.get('RoleName') !== 'gamma') {
        return answer();
      }
      return new Promise<Answer>((resolve) => {
        release = () => {
          resolve(answer());
        };
      });
    };

    confirmDelete(dialog);
    await waitFor(() => {
      expect(sentSince(from).at(-1)).toBe('DeleteRole gamma');
    });
    expect(isDisabled(confirmButton(dialog))).toBe(true);
    expect(dialog).toHaveTextContent('Deleting roles');
    const during = engine.sent.length;
    fireEvent.click(confirmButton(dialog));
    expect(engine.sent.length).toBe(during);

    release();
    await expectClosed();
    expect(sentSince(from).filter((sent) => !sent.startsWith('ListRoles') && !sent.startsWith('GetRole'))).toEqual([
      ...PLAIN_STEPS('alpha'),
      `DeleteServiceLinkedRole ${LINKED.name}`,
      ...PLAIN_STEPS('gamma'),
    ]);
  });

  it('one role deleted: the dialog closes, "1 role was deleted from the local emulator.", a new listing', async () => {
    const { dialog } = await openDialog([{ name: 'solo' }, { name: 'stays' }], ['solo']);
    const lists = engine.lists.length;

    confirmDelete(dialog);
    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: 'success', text: '1 role was deleted from the local emulator.' }]);
    });
    await expectListNames(['stays']);
    expect(engine.lists.length).toBeGreaterThan(lists);
    expect(engine.lists.at(-1)?.params.has('Marker')).toBe(false);
  });

  it('three deleted: "3 roles were deleted from the local emulator."', async () => {
    const { dialog } = await openDialog(THREE);

    confirmDelete(dialog);
    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: 'success', text: '3 roles were deleted from the local emulator.' }]);
    });
  });

  it('DeleteRole of the second of three refused with DeleteConflict: closes after the third; its error item, "2 roles were deleted…", a new listing', async () => {
    const { dialog } = await openDialog(THREE);
    const from = engine.sent.length;
    engine.handlers.DeleteRole = (params) =>
      params.get('RoleName') === 'beta'
        ? errorAnswer(409, 'DeleteConflict', 'Cannot delete entity, must <b>detach</b> all policies first.')
        : engine.emulator('DeleteRole', params);

    confirmDelete(dialog);
    await expectClosed();
    expect(sentSince(from)).toContain('DeleteRole gamma');
    await waitFor(() => {
      expect(flashItems()).toEqual([
        {
          type: 'error',
          text: 'Deleting beta failed DeleteConflict: Cannot delete entity, must <b>detach</b> all policies first.',
        },
        { type: 'success', text: '2 roles were deleted from the local emulator.' },
      ]);
    });
    expect(document.querySelector('.aws-area b')).toBeNull();
    await expectListNames(['beta']);
  });

  it('every role fails: one error item per role and no success item', async () => {
    const { dialog } = await openDialog([{ name: 'alpha' }, { name: 'beta' }]);
    engine.handlers.DeleteRole = () => errorAnswer(409, 'DeleteConflict', 'no');

    confirmDelete(dialog);
    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([
        { type: 'error', text: 'Deleting alpha failed DeleteConflict: no' },
        { type: 'error', text: 'Deleting beta failed DeleteConflict: no' },
      ]);
    });
  });

  it.each<[string, string, () => EngineAnswer, { type: string; text: string }]>([
    [
      '501',
      'ListAttachedRolePolicies',
      () => errorAnswer(501, 'NotImplemented', 'no'),
      {
        type: 'info',
        text: 'Not implemented by the emulator The emulator answered 501 Not Implemented for ListAttachedRolePolicies.',
      },
    ],
    [
      'AccessDenied',
      'DeleteRole',
      () => errorAnswer(403, 'AccessDenied', 'not yours'),
      { type: 'error', text: 'Access denied DeleteRole was refused: not yours' },
    ],
    [
      'EmulatorUnavailable',
      'ListInstanceProfilesForRole',
      () => engineRefusal(503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9313 could not be reached'),
      {
        type: 'error',
        text: 'The emulator did not answer The emulator at https://127.0.0.1:9313 could not be reached',
      },
    ],
    [
      'no answer',
      'DeleteRole',
      () => 'network-error',
      { type: 'error', text: 'The EmuForge engine at {origin} did not answer' },
    ],
  ])('a request answers %s (%s): its item of R10.3', async (_, action, answer, expected) => {
    const { dialog } = await openDialog([{ name: 'solo' }]);
    engine.handlers[action] = answer;

    confirmDelete(dialog);
    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: expected.type, text: expected.text.replace('{origin}', engineOrigin) }]);
    });
  });

  it('no success item before the last answer', async () => {
    const { dialog } = await openDialog([{ name: 'alpha' }, { name: 'beta' }]);
    let release: () => void = () => undefined;
    engine.handlers.DeleteRole = (params) =>
      params.get('RoleName') === 'beta'
        ? new Promise<Answer>((resolve) => {
            release = () => {
              resolve(engine.emulator('DeleteRole', params));
            };
          })
        : engine.emulator('DeleteRole', params);

    confirmDelete(dialog);
    await waitFor(() => {
      expect(engine.of('DeleteRole').map((sent) => sent.params.get('RoleName'))).toEqual(['alpha', 'beta']);
    });
    expect(flashItems()).toEqual([]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    release();
    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: 'success', text: '2 roles were deleted from the local emulator.' }]);
    });
  });
});
