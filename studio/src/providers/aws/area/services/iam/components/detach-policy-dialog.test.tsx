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

// Test criteria, "Unit s3 — …/components/detach-policy-dialog.test.tsx, delete-inline-policy-dialog.test.tsx" (issue
// 535, task 3): "Detach" of a managed policy on a role's page, against a fake engine behind `fetch`.

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

function customerPolicy(name: string): FakePolicy {
  return { name, arn: `arn:aws:iam::000000000000:policy/${name}` };
}

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

function given() {
  engine.policies = [customerPolicy('team-read')];
  engine.role('app', { attached: [customerPolicy('team-read')] });
}

async function openDetach(): Promise<HTMLElement> {
  await openRole('app');
  choose('team-read');
  fireEvent.click(action('Detach'));
  return dialog();
}

describe('Detach', () => {
  it('the header and body name the policy and the role; "Detach" sends one request; success → "Detached {policy} from {role}."', async () => {
    given();
    const modal = await openDetach();

    expect(within(modal).getByRole('heading', { name: 'Detach team-read?' })).toBeInTheDocument();
    expect(modal).toHaveTextContent('app loses what this policy allows. The policy stays in the local emulator.');
    fireEvent.click(within(modal).getByRole('button', { name: 'Detach' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      engine.of('DetachRolePolicy').map(({ params }) => [params.get('RoleName'), params.get('PolicyArn')]),
    ).toEqual([['app', customerPolicy('team-read').arn]]);
    expect(flashTexts()).toEqual(['Detached team-read from app.']);
    await waitFor(() => {
      expect(screen.getByText('No policies')).toBeInTheDocument();
    });
  });

  it('while in flight "Detaching", nothing reported; a refusal → the Flashbar with the code and message', async () => {
    given();
    const modal = await openDetach();
    let answer: () => void = () => undefined;
    engine.handlers.DetachRolePolicy = () =>
      new Promise((resolve) => {
        answer = () => {
          resolve(refusal(400, 'InvalidInput', 'the policy is held by a rule'));
        };
      });
    fireEvent.click(within(modal).getByRole('button', { name: 'Detach' }));

    expect(await within(modal).findByText('Detaching')).toBeInTheDocument();
    expect(flashes).toEqual([]);
    act(() => {
      answer();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(flashTexts()).toEqual(['Detaching team-read from app failed InvalidInput: the policy is held by a rule']);
  });

  it('"Cancel" sends nothing', async () => {
    given();
    const modal = await openDetach();
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(engine.of('DetachRolePolicy')).toEqual([]);
    expect(flashes).toEqual([]);
  });
});
