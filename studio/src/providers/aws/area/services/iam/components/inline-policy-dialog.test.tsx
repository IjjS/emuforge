import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { RolePage } from '../pages/role-page';

// Test criteria, "Unit s3 — providers/aws/area/services/iam/components/inline-policy-dialog.test.tsx" (issue 535,
// task 3): "Add inline policy" and an inline policy's "Edit" on a role's page, against a fake engine behind `fetch`.

// ---------------------------------------------------------------------------------------------------------------
// The fake engine: IAM's Query protocol over the roles and policies it holds.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

interface Sent {
  action: string;
  params: URLSearchParams;
}

interface FakePolicy {
  name: string;
  arn: string;
}

interface FakeRole {
  name: string;
  path?: string;
  attached: FakePolicy[];
  /** Inline policies by name, each with its document as it was sent. */
  inline: Map<string, string>;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ok(action: string, result: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
  };
}

function refusal(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${esc(code)}</Code><Message>${esc(message)}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
  };
}

const TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

class FakeEngine {
  roles: FakeRole[] = [];
  policies: FakePolicy[] = [];
  readonly sent: Sent[] = [];
  /** An answer of a case's own for an operation; the emulator's default otherwise. */
  handlers: Record<string, (params: URLSearchParams) => EngineAnswer> = {};

  role(name: string, init: Partial<Omit<FakeRole, 'name'>> = {}): FakeRole {
    const role: FakeRole = { name, attached: [], inline: new Map(), ...init };
    this.roles.push(role);
    return role;
  }

  find(name: string | null): FakeRole | undefined {
    return this.roles.find((role) => role.name.toLowerCase() === (name ?? '').toLowerCase());
  }

  emulator(action: string, params: URLSearchParams): Answer {
    if (action === 'ListPolicies') {
      const max = Number(params.get('MaxItems') ?? '100');
      const from = Number(params.get('Marker') ?? '0');
      const page = this.policies.slice(from, from + max);
      const more = from + max < this.policies.length;
      const members = page
        .map((p) => `<member><PolicyName>${esc(p.name)}</PolicyName><Arn>${esc(p.arn)}</Arn></member>`)
        .join('');
      return ok(
        action,
        `<Policies>${members}</Policies><IsTruncated>${String(more)}</IsTruncated>${more ? `<Marker>${String(from + max)}</Marker>` : ''}`,
      );
    }
    const role = this.find(params.get('RoleName'));
    if (role === undefined) {
      return refusal(404, 'NoSuchEntity', `The role with name ${params.get('RoleName') ?? ''} cannot be found.`);
    }
    const arn = params.get('PolicyArn') ?? '';
    const policyName = params.get('PolicyName') ?? '';
    switch (action) {
      case 'GetRole':
        return ok(
          action,
          `<Role><Path>${esc(role.path ?? '/')}</Path><RoleName>${esc(role.name)}</RoleName><RoleId>AROA1</RoleId><Arn>arn:aws:iam::000000000000:role${esc(role.path ?? '/')}${esc(role.name)}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><AssumeRolePolicyDocument>${esc(encodeURIComponent(TRUST))}</AssumeRolePolicyDocument><MaxSessionDuration>3600</MaxSessionDuration><RoleLastUsed/></Role>`,
        );
      case 'ListAttachedRolePolicies':
        return ok(
          action,
          `<AttachedPolicies>${role.attached
            .map((p) => `<member><PolicyName>${esc(p.name)}</PolicyName><PolicyArn>${esc(p.arn)}</PolicyArn></member>`)
            .join('')}</AttachedPolicies><IsTruncated>false</IsTruncated>`,
        );
      case 'ListRolePolicies':
        return ok(
          action,
          `<PolicyNames>${[...role.inline.keys()].map((n) => `<member>${esc(n)}</member>`).join('')}</PolicyNames><IsTruncated>false</IsTruncated>`,
        );
      case 'AttachRolePolicy': {
        const policy = this.policies.find((p) => p.arn === arn) ?? { name: arn.slice(arn.lastIndexOf('/') + 1), arn };
        if (!role.attached.some((p) => p.arn === arn)) role.attached.push(policy);
        return ok(action, '');
      }
      case 'DetachRolePolicy':
        role.attached = role.attached.filter((p) => p.arn !== arn);
        return ok(action, '');
      case 'PutRolePolicy':
        role.inline.set(policyName, params.get('PolicyDocument') ?? '');
        return ok(action, '');
      case 'GetRolePolicy': {
        const document = role.inline.get(policyName);
        return document === undefined
          ? refusal(404, 'NoSuchEntity', `The role policy with name ${policyName} cannot be found.`)
          : ok(
              action,
              `<RoleName>${esc(role.name)}</RoleName><PolicyName>${esc(policyName)}</PolicyName><PolicyDocument>${esc(encodeURIComponent(document))}</PolicyDocument>`,
            );
      }
      case 'DeleteRolePolicy':
        role.inline.delete(policyName);
        return ok(action, '');
      default:
        return refusal(400, 'InvalidAction', action);
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 't' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    this.sent.push({ action, params });
    const handler = this.handlers[action];
    const answer = await (handler === undefined ? this.emulator(action, params) : handler(params));
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };

  of(action: string): Sent[] {
    return this.sent.filter((sent) => sent.action === action);
  }
}

/** Holds every answer of `action` until the returned call lets them go. */
function holdAnswers(action: string): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  engine.handlers[action] = async (params) => {
    await gate;
    return engine.emulator(action, params);
  };
  return () => {
    release();
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A role's page, rendered with the area's modal root and flash, as the area renders it.
// ---------------------------------------------------------------------------------------------------------------

let nextPort = 9650;
let engine: FakeEngine;
let connection: AreaConnection;
let flashes: FlashResult[];

beforeEach(() => {
  engine = new FakeEngine();
  flashes = [];
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  connection = {
    result: { kind: 'connected', checkedAt: Date.now(), emulator: { port: 9313, endpoint: 'https://127.0.0.1:9313' } },
    engineOrigin: engineEndpoint(nextPort),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Page({ name }: { name: string }) {
  const root = useRef<HTMLDivElement>(null);
  const flash = useMemo(
    () => ({
      show: (result: FlashResult) => {
        flashes.push(result);
      },
      handOver: () => undefined,
    }),
    [],
  );
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div ref={root}>
          <RolePage connection={connection} params={{ name }} />
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

/** The role's page, once its table "Permissions policies" is shown. */
async function openRole(name: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[`/aws/iam/roles/details/${name}`]}>
      <QueryClientProvider client={client}>
        <Page name={name} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 2, name: 'Permissions policies' });
}

/** The row of the table "Permissions policies" whose name reads `name`. */
function policyRow(name: string): HTMLElement {
  const table = screen.getByRole('table', { name: 'Permissions policies' });
  const row = within(table)
    .getAllByRole('row')
    .find((element) => (element.querySelectorAll('th, td')[1]?.textContent ?? '').trim() === name);
  expect(row, name).toBeDefined();
  return row as HTMLElement;
}

/** Chooses the row named `name`. */
function choose(name: string) {
  fireEvent.click(within(policyRow(name)).getByRole('radio'));
}

/** The button named `name`. */
function action(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** The open dialog. */
async function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

/** The text of every flash shown, in order. */
function flashTexts(): string[] {
  return flashes.flatMap((result) =>
    result.map((item) => {
      const { container, unmount } = render(
        <>
          {item.header}
          {item.header === undefined ? '' : ' '}
          {item.content}
        </>,
      );
      const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
      unmount();
      return text;
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------------------------------------------

const DOC_A =
  '{\n  "Version": "2012-10-17",\n  "Statement": [{"Effect": "Allow",  "Action": "s3:GetObject", "Resource": "*"}]\n}';
const DOC_B =
  '{\n  "Version": "2012-10-17",\n  "Statement": [{"Effect": "Allow",  "Action": "s3:PutObject", "Resource": "*"}]\n}';
const SKELETON =
  '{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Effect": "Allow",\n      "Action": [],\n      "Resource": "*"\n    }\n  ]\n}';

function given() {
  engine.role('app', { inline: new Map([['held', DOC_A]]) });
}

function nameField(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole('textbox', { name: 'Policy name' });
}

function documentField(modal: HTMLElement): HTMLTextAreaElement {
  return within(modal).getByRole('textbox', { name: 'Policy document' }) as HTMLTextAreaElement;
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

async function openAdd(): Promise<HTMLElement> {
  await openRole('app');
  fireEvent.click(action('Add inline policy'));
  return dialog();
}

async function openEdit(): Promise<HTMLElement> {
  await openRole('app');
  choose('held');
  fireEvent.click(action('Edit inline policy'));
  return dialog();
}

function saveButton(modal: HTMLElement, name: 'Add policy' | 'Save changes'): HTMLElement {
  return within(modal).getByRole('button', { name });
}

describe('Add', () => {
  it('the constraint from the start, the skeleton in the editor; each failed check shows its message and sends nothing', async () => {
    given();
    const modal = await openAdd();

    expect(within(modal).getByRole('heading', { name: 'Add inline policy' })).toBeInTheDocument();
    expect(modal).toHaveTextContent(
      '1 to 128 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.',
    );
    expect(documentField(modal).value).toBe(SKELETON);

    const cases: [string, string, string][] = [
      ['', SKELETON, 'Enter a policy name.'],
      ['a'.repeat(129), SKELETON, 'The name can have up to 128 characters.'],
      ['my policy', SKELETON, 'The name can have only letters, digits and the characters + = , . @ _ -.'],
      ['held', SKELETON, 'app already has an inline policy named held.'],
      ['fresh', '{"Version": ', 'Enter the policy as one JSON value.'],
    ];
    for (const [name, text, message] of cases) {
      type(nameField(modal), name);
      type(documentField(modal), text);
      fireEvent.click(saveButton(modal, 'Add policy'));
      expect(within(modal).getByText(message)).toBeInTheDocument();
    }
    expect(engine.of('PutRolePolicy')).toEqual([]);
  });

  it('valid → one request with the name and the text as typed; success → "Inline policy {name} added to {role}." and the dialog closes', async () => {
    given();
    const modal = await openAdd();
    type(nameField(modal), 'fresh');
    type(documentField(modal), DOC_B);
    fireEvent.click(saveButton(modal, 'Add policy'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const puts = engine.of('PutRolePolicy');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.params.get('RoleName')).toBe('app');
    expect(puts[0]?.params.get('PolicyName')).toBe('fresh');
    expect(puts[0]?.params.get('PolicyDocument')).toBe(DOC_B);
    expect(flashTexts()).toEqual(['Inline policy fresh added to app.']);
    await waitFor(() => {
      expect(policyRow('fresh')).toHaveTextContent('Customer inline');
    });
  });

  it('a refusal → the dialog stays with the code and message and the text kept; the role is read again', async () => {
    given();
    const modal = await openAdd();
    engine.handlers.PutRolePolicy = () => refusal(400, 'MalformedPolicyDocument', 'Syntax errors in policy.');
    const reads = engine.of('GetRole').length;
    type(nameField(modal), 'fresh');
    type(documentField(modal), '[1]');
    fireEvent.click(saveButton(modal, 'Add policy'));

    expect(await within(modal).findByText(/Syntax errors in policy\./)).toBeInTheDocument();
    expect(modal).toHaveTextContent('MalformedPolicyDocument: Syntax errors in policy.');
    expect(screen.getByRole('dialog')).toBe(modal);
    expect(nameField(modal)).toHaveValue('fresh');
    expect(documentField(modal).value).toBe('[1]');
    expect(flashes).toEqual([]);
    await waitFor(() => {
      expect(engine.of('GetRole').length).toBeGreaterThan(reads);
    });
  });
});

describe('Edit', () => {
  it('the name is text; the editor holds the document read; while it is read no editor and no save; "Save changes" sends the same name', async () => {
    given();
    const release = holdAnswers('GetRolePolicy');
    const modal = await openEdit();

    expect(within(modal).getByRole('heading', { name: 'Edit held' })).toBeInTheDocument();
    expect(within(modal).queryByRole('textbox', { name: 'Policy name' })).toBeNull();
    expect(modal).toHaveTextContent('held');
    expect(within(modal).getByText('Loading the policy document')).toBeInTheDocument();
    expect(within(modal).queryByRole('textbox', { name: 'Policy document' })).toBeNull();
    expect(saveButton(modal, 'Save changes')).toBeDisabled();

    act(() => {
      release();
    });
    await waitFor(() => {
      expect(documentField(modal).value).toBe(DOC_A);
    });
    type(documentField(modal), DOC_B);
    fireEvent.click(saveButton(modal, 'Save changes'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const puts = engine.of('PutRolePolicy');
    expect(puts.map(({ params }) => [params.get('PolicyName'), params.get('PolicyDocument')])).toEqual([
      ['held', DOC_B],
    ]);
    expect(flashTexts()).toEqual(['Inline policy held of app saved.']);
  });

  it('a failed read → its words and a retry, which reads again', async () => {
    given();
    engine.handlers.GetRolePolicy = () => refusal(400, 'ServiceFailure', 'the store is down');
    const modal = await openEdit();

    expect(await within(modal).findByText('The policy document could not be read')).toBeInTheDocument();
    expect(modal).toHaveTextContent('ServiceFailure: the store is down');
    expect(saveButton(modal, 'Save changes')).toBeDisabled();

    delete engine.handlers.GetRolePolicy;
    fireEvent.click(within(modal).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(documentField(modal).value).toBe(DOC_A);
    });
  });
});

describe('the answer', () => {
  it('nothing is reported as done before it', async () => {
    given();
    const modal = await openAdd();
    const release = holdAnswers('PutRolePolicy');
    type(nameField(modal), 'fresh');
    fireEvent.click(saveButton(modal, 'Add policy'));

    expect(await within(modal).findByText('Adding')).toBeInTheDocument();
    await waitFor(() => {
      expect(engine.of('PutRolePolicy')).toHaveLength(1);
    });
    expect(flashes).toEqual([]);
    expect(screen.getByRole('dialog')).toBe(modal);

    act(() => {
      release();
    });
    await waitFor(() => {
      expect(flashTexts()).toEqual(['Inline policy fresh added to app.']);
    });
  });
});
