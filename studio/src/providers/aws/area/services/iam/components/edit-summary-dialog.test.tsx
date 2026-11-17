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

// The dialog "Edit summary", opened with "Edit" on a role's page inside the area's layout, as Studio's frame renders
// the area, against a fake engine behind the page's `fetch` (test-criteria.md, issue 82, "Unit —
// services/iam/components/edit-summary-dialog.test.tsx"; requirement R5.5, R10.3).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the roles it holds.
// ---------------------------------------------------------------------------------------------------------------

interface FakeRole {
  name: string;
  path?: string;
  /** The trust policy as JSON; percent-encoded in the answer, as the emulator sends it. */
  trust?: string;
  description?: string;
  maxSessionDuration?: number;
  lastUsed?: string;
  boundary?: string;
  /** Attached managed policies, in the emulator's order. */
  attached?: { name: string; arn: string }[];
  /** Inline policy names, in the emulator's order. */
  inline?: string[];
  attachedTruncated?: boolean;
  inlineTruncated?: boolean;
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

const CREATED = '2026-11-17T09:05:03Z';

function arnOf({ name, path = '/' }: FakeRole): string {
  return `arn:aws:iam::000000000000:role${path}${name}`;
}

function roleXml(role: FakeRole): string {
  const { name, path = '/', trust = LAMBDA_TRUST, description, maxSessionDuration = 3600 } = role;
  return [
    `<Path>${esc(path)}</Path><RoleName>${esc(name)}</RoleName><RoleId>AROA${String(name.length)}</RoleId>`,
    `<Arn>${esc(arnOf(role))}</Arn><CreateDate>${CREATED}</CreateDate>`,
    `<AssumeRolePolicyDocument>${esc(encodeURIComponent(trust))}</AssumeRolePolicyDocument>`,
    description === undefined ? '' : `<Description>${esc(description)}</Description>`,
    `<MaxSessionDuration>${String(maxSessionDuration)}</MaxSessionDuration>`,
  ].join('');
}

class FakeEngine {
  /** The roles the emulator holds. */
  roles: FakeRole[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};
  private sessions = 0;

  /** The role named so, ignoring case, as the emulator matches names (R2). */
  find(name: string | null): FakeRole | undefined {
    return this.roles.find((role) => role.name.toLowerCase() === (name ?? '').toLowerCase());
  }

  emulator(action: string, params: URLSearchParams): Answer {
    const role = this.find(params.get('RoleName'));
    if (role === undefined && action !== 'ListRoles') {
      return errorAnswer(404, 'NoSuchEntity', `The role with name ${params.get('RoleName') ?? ''} cannot be found.`);
    }
    switch (action) {
      case 'GetRole': {
        const held = role as FakeRole;
        const boundary =
          held.boundary === undefined
            ? ''
            : `<PermissionsBoundary><PermissionsBoundaryType>Policy</PermissionsBoundaryType><PermissionsBoundaryArn>${esc(held.boundary)}</PermissionsBoundaryArn></PermissionsBoundary>`;
        const used =
          held.lastUsed === undefined
            ? '<RoleLastUsed/>'
            : `<RoleLastUsed><LastUsedDate>${held.lastUsed}</LastUsedDate></RoleLastUsed>`;
        return ok(action, `<Role>${roleXml(held)}${boundary}${used}</Role>`);
      }
      case 'ListAttachedRolePolicies': {
        const held = role as FakeRole;
        const members = (held.attached ?? [])
          .map(
            ({ name, arn }) =>
              `<member><PolicyName>${esc(name)}</PolicyName><PolicyArn>${esc(arn)}</PolicyArn></member>`,
          )
          .join('');
        return ok(
          action,
          `<AttachedPolicies>${members}</AttachedPolicies><IsTruncated>${String(held.attachedTruncated === true)}</IsTruncated>${held.attachedTruncated === true ? '<Marker>m</Marker>' : ''}`,
        );
      }
      case 'ListRolePolicies': {
        const held = role as FakeRole;
        const members = (held.inline ?? []).map((name) => `<member>${esc(name)}</member>`).join('');
        return ok(
          action,
          `<PolicyNames>${members}</PolicyNames><IsTruncated>${String(held.inlineTruncated === true)}</IsTruncated>${held.inlineTruncated === true ? '<Marker>m</Marker>' : ''}`,
        );
      }
      case 'UpdateRole': {
        const held = role as FakeRole;
        const description = params.get('Description');
        if (description !== null) {
          held.description = description;
        }
        const duration = params.get('MaxSessionDuration');
        if (duration !== null) {
          held.maxSessionDuration = Number(duration);
        }
        return ok(action, '');
      }
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

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9450;
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
  vi.unstubAllGlobals();
});

function pagePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

function open(path: string) {
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
  return { ...result, router };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

function main(): HTMLElement {
  return screen.getByRole('main');
}

/** The pairs of "Summary": label and value, in order. */
function summaryPairs(): [string, string][] {
  const pairs = PAGE.findKeyValuePairs();
  expect(pairs).not.toBeNull();
  return (pairs as NonNullable<typeof pairs>)
    .findItems()
    .map((item) => [
      (item.findLabel()?.getElement().textContent ?? '').trim(),
      (item.findValue()?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim(),
    ]);
}

/** Holds every answer of `action` until the returned call lets them go. */
function holdAnswers(action: string): () => void {
  const waiting: (() => void)[] = [];
  let holding = true;
  engine.handlers[action] = (params) => {
    const answer = () => engine.emulator(action, params);
    if (!holding) {
      return answer();
    }
    return new Promise<Answer>((resolve) => {
      waiting.push(() => {
        resolve(answer());
      });
    });
  };
  return () => {
    holding = false;
    for (const release of waiting.splice(0)) {
      release();
    }
  };
}

function editButton(): HTMLElement {
  return within(main()).getByRole('button', { name: 'Edit' });
}

/** Opens the page of `role` and its dialog "Edit summary". */
async function openDialog(role: FakeRole) {
  // A copy: the fake emulator changes the role it holds.
  engine.roles = [{ ...role }];
  const opened = open(pagePath(role.name));
  await waitFor(() => {
    expect(within(main()).getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });
  fireEvent.click(editButton());
  const dialog = await screen.findByRole('dialog', { name: 'Edit summary' });
  return { ...opened, dialog };
}

function wrapperOf(dialog: HTMLElement) {
  return createWrapper(dialog);
}

function descriptionField(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
}

function typeDescription(dialog: HTMLElement, text: string) {
  fireEvent.change(descriptionField(dialog), { target: { value: text } });
}

function durationSelect(dialog: HTMLElement) {
  const select = wrapperOf(dialog).findSelect();
  expect(select).not.toBeNull();
  return select as NonNullable<typeof select>;
}

/** The option the select shows. */
function durationShown(dialog: HTMLElement): string {
  return (durationSelect(dialog).findTrigger().getElement().textContent ?? '').trim();
}

/** The select's option values by label, as the dialog gives them. */
const DURATION_VALUES: Readonly<Record<string, string>> = {
  '1 hour': '3600',
  '2 hours': '7200',
  '4 hours': '14400',
  '8 hours': '28800',
  '12 hours': '43200',
  'Custom duration': 'custom',
};

function chooseDuration(dialog: HTMLElement, label: string) {
  const select = durationSelect(dialog);
  act(() => {
    select.openDropdown();
  });
  act(() => {
    select.selectOptionByValue(DURATION_VALUES[label] ?? label);
  });
  expect(durationShown(dialog)).toBe(label);
}

function optionLabels(dialog: HTMLElement): string[] {
  const select = durationSelect(dialog);
  select.openDropdown();
  const labels = select
    .findDropdown()
    .findOptions()
    .map((option) => (option.getElement().textContent ?? '').trim());
  select.findTrigger().click();
  return labels;
}

function secondsField(dialog: HTMLElement): HTMLInputElement | null {
  return within(dialog).queryByRole('textbox', { name: 'Seconds' }) as HTMLInputElement | null;
}

function typeSeconds(dialog: HTMLElement, text: string) {
  const field = secondsField(dialog);
  expect(field).not.toBeNull();
  fireEvent.change(field as HTMLInputElement, { target: { value: text } });
}

function saveButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: /Save changes|Saving changes/ });
}

function save(dialog: HTMLElement) {
  fireEvent.click(saveButton(dialog));
}

/** A Cloudscape button is disabled by `disabled`, or with a reason or while loading by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function updates(): Sent[] {
  return engine.of('UpdateRole');
}

/** What the last `UpdateRole` carried: its description and its duration, or `null` for a field not sent. */
function lastUpdate(): { name: string | null; description: string | null; duration: string | null } {
  const sent = updates().at(-1);
  expect(sent).toBeDefined();
  const params = (sent as Sent).params;
  return {
    name: params.get('RoleName'),
    description: params.get('Description'),
    duration: params.get('MaxSessionDuration'),
  };
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
  return (['success', 'error', 'info', 'warning'] as const).flatMap((type) =>
    flashbar.findItemsByType(type).map((item) => ({
      type,
      text: [item.findHeader(), item.findContent()]
        .map((part) => (part?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((part) => part !== '')
        .join(' '),
    })),
  );
}

/** The dialog's alert: its type and its text. */
function dialogAlert(dialog: HTMLElement): { type: string | undefined; text: string } | undefined {
  const alert = wrapperOf(dialog).findAlert();
  if (alert === null) {
    return undefined;
  }
  const element = alert.getElement();
  const type = [...element.querySelectorAll('*'), element]
    .flatMap((node) => [...node.classList])
    .map((name) => /^awsui_type-([a-z]+)_/.exec(name)?.[1])
    .find((found) => found !== undefined);
  const text = [alert.findHeader(), alert.findContent()]
    .map((part) => (part?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(' ');
  return { type, text };
}

const ROLE_D: FakeRole = { name: 'team-role', description: 'd', maxSessionDuration: 7200 };

// ---------------------------------------------------------------------------------------------------------------

describe('the dialog', () => {
  it('"Edit" on a role with "d" and 7200 seconds: "Edit summary", "Description" holds d, "2 hours" of the six options, the buttons, no "Seconds"', async () => {
    const { dialog } = await openDialog(ROLE_D);

    expect(descriptionField(dialog).value).toBe('d');
    expect(durationShown(dialog)).toBe('2 hours');
    expect(optionLabels(dialog)).toEqual(['1 hour', '2 hours', '4 hours', '8 hours', '12 hours', 'Custom duration']);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(saveButton(dialog)).toHaveTextContent('Save changes');
    expect(secondsField(dialog)).toBeNull();
  });

  it('a role with 5400 seconds: "Custom duration" with "Seconds" 5400; "Custom duration" chosen on another role: "Seconds" appears', async () => {
    const { dialog, unmount } = await openDialog({ name: 'odd-duration', maxSessionDuration: 5400 });

    expect(durationShown(dialog)).toBe('Custom duration');
    expect(secondsField(dialog)?.value).toBe('5400');
    unmount();

    const other = await openDialog({ name: 'plain-role' });
    expect(durationShown(other.dialog)).toBe('1 hour');
    expect(secondsField(other.dialog)).toBeNull();
    chooseDuration(other.dialog, 'Custom duration');
    expect(secondsField(other.dialog)).not.toBeNull();
  });
});

describe('the rules at "Save changes"', () => {
  it('a description of 1001 characters: the message under it and no request; 1000 characters: sent', async () => {
    const { dialog } = await openDialog(ROLE_D);

    typeDescription(dialog, 'x'.repeat(1001));
    save(dialog);
    expect(await within(dialog).findByText('The description can have up to 1000 characters.')).toBeInTheDocument();
    expect(updates()).toEqual([]);

    typeDescription(dialog, 'x'.repeat(1000));
    save(dialog);
    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(lastUpdate().description).toBe('x'.repeat(1000));
  });

  it.each(['3599', '43201', '1.5', '', 'abc'])(
    '"Seconds" %j: "Enter a whole number from 3600 to 43200." and no request',
    async (seconds) => {
      const { dialog } = await openDialog(ROLE_D);

      chooseDuration(dialog, 'Custom duration');
      typeSeconds(dialog, seconds);
      save(dialog);

      expect(await within(dialog).findByText('Enter a whole number from 3600 to 43200.')).toBeInTheDocument();
      expect(updates()).toEqual([]);
    },
  );

  it.each(['3600', '43200'])('"Seconds" %s: sent', async (seconds) => {
    const { dialog } = await openDialog(ROLE_D);

    chooseDuration(dialog, 'Custom duration');
    typeSeconds(dialog, seconds);
    save(dialog);

    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(lastUpdate().duration).toBe(seconds);
  });
});

describe('saving', () => {
  it('the description changed only: one update with it and no duration; in flight "Save changes" is disabled with progress, keeps focus, a second press sends nothing', async () => {
    const { dialog } = await openDialog(ROLE_D);
    const release = holdAnswers('UpdateRole');

    typeDescription(dialog, 'new words');
    const button = saveButton(dialog);
    act(() => {
      button.focus();
    });
    save(dialog);
    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(isDisabled(saveButton(dialog))).toBe(true);
    expect(dialog).toHaveTextContent('Saving changes');
    expect(document.activeElement).toBe(saveButton(dialog));
    save(dialog);
    expect(updates()).toHaveLength(1);
    expect(lastUpdate()).toEqual({ name: 'team-role', description: 'new words', duration: null });

    release();
    await expectClosed();
  });

  it('"4 hours": the update carries 14400', async () => {
    const { dialog } = await openDialog(ROLE_D);

    chooseDuration(dialog, '4 hours');
    save(dialog);

    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(lastUpdate()).toEqual({ name: 'team-role', description: 'd', duration: '14400' });
  });

  it('"Custom duration" with 5000: the update carries 5000', async () => {
    const { dialog } = await openDialog(ROLE_D);

    chooseDuration(dialog, 'Custom duration');
    typeSeconds(dialog, '5000');
    save(dialog);

    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(lastUpdate().duration).toBe('5000');
  });

  it('nothing changed: the description alone', async () => {
    const { dialog } = await openDialog(ROLE_D);

    save(dialog);

    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(lastUpdate()).toEqual({ name: 'team-role', description: 'd', duration: null });
  });

  it('the update succeeds: the dialog closes, the role is read again, the Flashbar says it was updated, and it is announced', async () => {
    const { dialog } = await openDialog(ROLE_D);
    const reads = engine.of('GetRole').length;

    typeDescription(dialog, 'saved words');
    chooseDuration(dialog, '4 hours');
    save(dialog);

    await expectClosed();
    const text = 'Role “team-role” was updated in the local emulator.';
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: 'success', text }]);
    });
    await waitFor(() => {
      expect(engine.of('GetRole').length).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      const pairs = new Map(summaryPairs());
      expect(pairs.get('Description')).toBe('saved words');
      expect(pairs.get('Maximum session duration')).toBe('4 hours');
    });
    await waitFor(() => {
      expect(document.querySelector('[role="status"].aws-area-flash-announcer')).toHaveTextContent(text);
    });
  });

  it('refused with UnmodifiableEntity: the dialog stays with its values and shows "Updating <name> failed" with the code and message above its buttons; "Save changes" enabled again', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    engine.handlers.UpdateRole = () => errorAnswer(400, 'UnmodifiableEntity', `cannot change ${markup}`);
    const { dialog } = await openDialog(ROLE_D);

    typeDescription(dialog, 'kept words');
    chooseDuration(dialog, '8 hours');
    save(dialog);

    await waitFor(() => {
      expect(dialogAlert(dialog)).toEqual({
        type: 'error',
        text: `Updating team-role failed UnmodifiableEntity: cannot change ${markup}`,
      });
    });
    expect(screen.getByRole('dialog', { name: 'Edit summary' })).toBe(dialog);
    expect(descriptionField(dialog).value).toBe('kept words');
    expect(durationShown(dialog)).toBe('8 hours');
    expect(isDisabled(saveButton(dialog))).toBe(false);
    expect(document.querySelector('img')).toBeNull();
    const alert = wrapperOf(dialog).findAlert()?.getElement() as HTMLElement;
    expect(alert.compareDocumentPosition(saveButton(dialog)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(flashItems()).toEqual([]);
  });

  it.each<[string, () => EngineAnswer, { type: string; text: string }]>([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'no'),
      {
        type: 'info',
        text: 'Not implemented by the emulator The emulator answered 501 Not Implemented for UpdateRole.',
      },
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      { type: 'error', text: 'Access denied UpdateRole was refused: not for you' },
    ],
    [
      'EmulatorUnavailable',
      () => engineRefusal(503, 'EmulatorUnavailable', 'The emulator could not be reached'),
      { type: 'error', text: 'The emulator did not answer The emulator could not be reached' },
    ],
    [
      'no answer from the engine',
      () => 'network-error',
      { type: 'error', text: 'The EmuForge engine at {origin} did not answer' },
    ],
  ])('%s: the result above the buttons, the values kept', async (_, answer, expected) => {
    engine.handlers.UpdateRole = answer;
    const { dialog } = await openDialog(ROLE_D);

    typeDescription(dialog, 'kept words');
    save(dialog);

    await waitFor(() => {
      expect(dialogAlert(dialog)).toEqual({
        type: expected.type,
        text: expected.text.replace('{origin}', engineOrigin),
      });
    });
    expect(descriptionField(dialog).value).toBe('kept words');
    expect(durationShown(dialog)).toBe('2 hours');
  });
});

describe('closing', () => {
  it('"Cancel" and Esc close it without a request, focus on "Edit"; while open, Tab stays inside', async () => {
    const { dialog } = await openDialog(ROLE_D);
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

    typeDescription(dialog, 'never sent');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expectClosed('after Cancel');
    expect(engine.sent.length).toBe(sent);
    await waitFor(() => {
      expect(document.activeElement).toBe(editButton());
    });

    fireEvent.click(editButton());
    const again = await screen.findByRole('dialog', { name: 'Edit summary' });
    expect(descriptionField(again).value).toBe('d');
    fireEvent.keyDown(descriptionField(again), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await expectClosed('after Esc');
    expect(engine.sent.length).toBe(sent);
    await waitFor(() => {
      expect(document.activeElement).toBe(editButton());
    });
  });
});
