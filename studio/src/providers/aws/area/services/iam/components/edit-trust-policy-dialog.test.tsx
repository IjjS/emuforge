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

// The dialog "Edit trust policy", opened on the tab "Trust relationships" of a role's page inside the area's layout,
// as Studio's frame renders the area, against a fake engine behind the page's `fetch` (test-criteria.md, issue 535,
// "Unit s4 — …/edit-trust-policy-dialog.test.tsx"; requirement, task 4).

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
      case 'UpdateAssumeRolePolicy': {
        // The emulator keeps the text as sent and returns it compact (requirement, probe-1).
        const held = role as FakeRole;
        held.trust = JSON.stringify(JSON.parse(params.get('PolicyDocument') ?? '') as unknown);
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
  return `/aws/iam/roles/details/${encodeURIComponent(name)}?tab=trust`;
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

/** The text of the section headed `heading` on the tab, its heading and actions left out. */
function sectionText(heading: string): string {
  const container = createWrapper(main())
    .findAllContainers()
    .find((found) => (found.findHeader()?.getElement().textContent ?? '').includes(heading));
  expect(container, heading).toBeDefined();
  return container?.findContent().getElement().textContent ?? '';
}

function editButton(): HTMLElement {
  return within(main()).getByRole('button', { name: 'Edit trust policy' });
}

/** Opens the trust tab of `role` and its dialog "Edit trust policy". */
async function openDialog(role: FakeRole) {
  // A copy: the fake emulator changes the role it holds.
  engine.roles = [{ ...role }];
  const opened = open(pagePath(role.name));
  await waitFor(() => {
    expect(within(main()).getByRole('heading', { level: 2, name: 'Trust policy' })).toBeInTheDocument();
  });
  fireEvent.click(editButton());
  const dialog = await screen.findByRole('dialog', { name: 'Edit trust policy' });
  return { ...opened, dialog };
}

function field(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByRole('textbox', { name: /Trust policy/ }) as HTMLTextAreaElement;
}

function type(dialog: HTMLElement, text: string) {
  fireEvent.change(field(dialog), { target: { value: text } });
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
  return engine.of('UpdateAssumeRolePolicy');
}

/** The message under the editor, `null` for none. */
function fieldError(dialog: HTMLElement): string | null {
  const error = createWrapper(dialog).findFormField()?.findError();
  return error === null || error === undefined ? null : (error.getElement().textContent ?? '').trim();
}

async function expectClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

/** The Flashbar's items: type and text. */
function flashItems(): { type: string; text: string }[] {
  const flashbar = PAGE.findFlashbar();
  if (flashbar === null) {
    return [];
  }
  return (['success', 'error', 'info', 'warning'] as const).flatMap((kind) =>
    flashbar.findItemsByType(kind).map((item) => ({
      type: kind,
      text: [item.findHeader(), item.findContent()]
        .map((part) => (part?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((part) => part !== '')
        .join(' '),
    })),
  );
}

/** The dialog's alert: its type and its text. */
function dialogAlert(dialog: HTMLElement): { type: string | undefined; text: string } | undefined {
  const alert = createWrapper(dialog).findAlert();
  if (alert === null) {
    return undefined;
  }
  const element = alert.getElement();
  const kind = [...element.querySelectorAll('*'), element]
    .flatMap((node) => [...node.classList])
    .map((name) => /^awsui_type-([a-z]+)_/.exec(name)?.[1])
    .find((found) => found !== undefined);
  const text = [alert.findHeader(), alert.findContent()]
    .map((part) => (part?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(' ');
  return { type: kind, text };
}

const ROLE: FakeRole = { name: 'team-role' };

const EC2_TRUST = `{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" }
  ]
}`;

// ---------------------------------------------------------------------------------------------------------------

describe('"Edit trust policy"', () => {
  it('the editor holds the document as the tab shows it', async () => {
    const { dialog } = await openDialog(ROLE);

    expect(field(dialog).value).toBe(JSON.stringify(JSON.parse(LAMBDA_TRUST), null, 2));
    expect(field(dialog).value).toBe(sectionText('Trust policy'));
    expect(updates()).toEqual([]);
  });

  it.each(['', '{ "Version": ', 'not json', '{} {}'])(
    'a text that is not one JSON value (%j): "Enter the trust policy as one JSON value." and nothing sent',
    async (text) => {
      const { dialog } = await openDialog(ROLE);

      type(dialog, text);
      save(dialog);

      await waitFor(() => {
        expect(fieldError(dialog)).toBe('Enter the trust policy as one JSON value.');
      });
      expect(updates()).toEqual([]);
      expect(screen.getByRole('dialog', { name: 'Edit trust policy' })).toBe(dialog);
      expect(field(dialog).value).toBe(text);
    },
  );

  it('a valid text: one request with the role and the text as typed, white space and line breaks included; in flight "Saving changes" and a second press sends nothing', async () => {
    const release = holdAnswers('UpdateAssumeRolePolicy');
    const { dialog } = await openDialog(ROLE);

    type(dialog, EC2_TRUST);
    save(dialog);

    await waitFor(() => {
      expect(updates()).toHaveLength(1);
    });
    expect(isDisabled(saveButton(dialog))).toBe(true);
    expect(dialog).toHaveTextContent('Saving changes');
    save(dialog);
    expect(updates()).toHaveLength(1);
    release();
    await expectClosed();

    expect(updates()).toHaveLength(1);
    expect(updates()[0]?.params.get('RoleName')).toBe('team-role');
    expect(updates()[0]?.params.get('PolicyDocument')).toBe(EC2_TRUST);
  });

  it('success: "Trust policy of team-role saved.", the dialog closes, the role is read again and the tab shows the new document and entities', async () => {
    const { dialog } = await openDialog(ROLE);
    const reads = engine.of('GetRole').length;
    expect(sectionText('Trusted entities')).toBe('AWS Service: lambda');

    type(dialog, EC2_TRUST);
    save(dialog);

    await expectClosed();
    await waitFor(() => {
      expect(flashItems()).toEqual([{ type: 'success', text: 'Trust policy of team-role saved.' }]);
    });
    await waitFor(() => {
      expect(engine.of('GetRole').length).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      expect(sectionText('Trusted entities')).toBe('AWS Service: ec2');
    });
    expect(sectionText('Trust policy')).toBe(JSON.stringify(JSON.parse(EC2_TRUST), null, 2));
  });

  it('a refusal: the dialog stays with the code and message above its buttons and the text kept; nothing in the Flashbar', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    engine.handlers.UpdateAssumeRolePolicy = () =>
      errorAnswer(400, 'MalformedPolicyDocument', `Invalid principal in policy: ${markup}`);
    const { dialog } = await openDialog(ROLE);

    type(dialog, EC2_TRUST);
    save(dialog);

    await waitFor(() => {
      expect(dialogAlert(dialog)).toEqual({
        type: 'error',
        text: `Saving the trust policy of team-role failed MalformedPolicyDocument: Invalid principal in policy: ${markup}`,
      });
    });
    expect(screen.getByRole('dialog', { name: 'Edit trust policy' })).toBe(dialog);
    expect(field(dialog).value).toBe(EC2_TRUST);
    expect(isDisabled(saveButton(dialog))).toBe(false);
    expect(document.querySelector('img')).toBeNull();
    const alert = createWrapper(dialog).findAlert()?.getElement() as HTMLElement;
    expect(alert.compareDocumentPosition(saveButton(dialog)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(flashItems()).toEqual([]);
  });

  it.each<[string, () => EngineAnswer, { type: string; text: string }]>([
    [
      '501',
      () => errorAnswer(501, 'NotImplemented', 'no'),
      {
        type: 'info',
        text: 'Not implemented by the emulator The emulator answered 501 Not Implemented for UpdateAssumeRolePolicy.',
      },
    ],
    [
      'AccessDenied',
      () => errorAnswer(403, 'AccessDenied', 'not for you'),
      { type: 'error', text: 'Access denied UpdateAssumeRolePolicy was refused: not for you' },
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
  ])('%s: its words above the buttons, the text kept', async (_, answer, expected) => {
    engine.handlers.UpdateAssumeRolePolicy = answer;
    const { dialog } = await openDialog(ROLE);

    type(dialog, EC2_TRUST);
    save(dialog);

    await waitFor(() => {
      expect(dialogAlert(dialog)).toEqual({
        type: expected.type,
        text: expected.text.replace('{origin}', engineOrigin),
      });
    });
    expect(field(dialog).value).toBe(EC2_TRUST);
  });

  it('"Cancel" closes it without a request', async () => {
    const { dialog } = await openDialog(ROLE);

    type(dialog, EC2_TRUST);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await expectClosed();
    expect(updates()).toEqual([]);
  });
});
