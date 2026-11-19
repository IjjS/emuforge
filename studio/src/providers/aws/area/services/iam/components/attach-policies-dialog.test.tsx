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

// Test criteria, "Unit s3 — providers/aws/area/services/iam/components/attach-policies-dialog.test.tsx" (issue 535,
// task 3): "Attach policies" opened on a role's page, against a fake engine behind `fetch`.

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

const NAMES = Array.from({ length: 25 }, (_, index) => `p-${String(index + 1).padStart(2, '0')}`);

function given() {
  engine.policies = NAMES.map(customerPolicy);
  engine.role('app', { attached: [customerPolicy('p-03')] });
}

/** The dialog's table of policies to attach. */
function choiceTable(within_: HTMLElement): HTMLElement {
  return within(within_).getByRole('table', { name: 'Policies to attach' });
}

function choiceNames(modal: HTMLElement): string[] {
  return within(choiceTable(modal))
    .getAllByRole('row')
    .slice(1)
    .map((row) => (row.querySelectorAll('th, td')[1]?.textContent ?? '').trim())
    .filter((name) => name !== '');
}

function choiceRow(modal: HTMLElement, name: string): HTMLElement {
  const row = within(choiceTable(modal))
    .getAllByRole('row')
    .find((element) => (element.querySelectorAll('th, td')[1]?.textContent ?? '').trim() === name);
  expect(row, name).toBeDefined();
  return row as HTMLElement;
}

async function openAttach(): Promise<HTMLElement> {
  await openRole('app');
  const opener = action('Attach policies');
  opener.focus();
  fireEvent.click(opener);
  const modal = await dialog();
  await within(modal).findByText('p-01');
  return modal;
}

function pick(modal: HTMLElement, ...names: string[]) {
  for (const name of names) {
    fireEvent.click(within(choiceRow(modal, name)).getByRole('checkbox'));
  }
}

function attachButton(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole('button', { name: 'Attach' });
}

describe('the policies', () => {
  it('listed page by page with the filter; one the role has is marked "Attached" and cannot be chosen', async () => {
    given();
    const modal = await openAttach();

    expect(within(modal).getByRole('heading', { name: 'Attach policies to app' })).toBeInTheDocument();
    expect(choiceNames(modal)).toEqual(NAMES.slice(0, 20));
    const attached = choiceRow(modal, 'p-03');
    expect(attached).toHaveTextContent('Attached');
    expect(within(attached).getByRole('checkbox')).toBeDisabled();
    expect(within(choiceRow(modal, 'p-04')).getByRole('checkbox')).not.toBeDisabled();

    fireEvent.click(within(modal).getByRole('button', { name: 'Next page' }));
    await within(modal).findByText('p-21');
    expect(choiceNames(modal)).toEqual(NAMES.slice(20));

    fireEvent.change(within(modal).getByRole('searchbox'), { target: { value: 'p-2' } });
    await waitFor(() => {
      expect(choiceNames(modal)).toEqual(['p-20', 'p-21', 'p-22', 'p-23', 'p-24', 'p-25']);
    });
  });
});

describe('"Attach"', () => {
  it('with nothing chosen → "Choose at least one policy." and nothing sent; while in flight "Attaching", the buttons unavailable, focus where it was', async () => {
    given();
    const modal = await openAttach();

    fireEvent.click(attachButton(modal));
    expect(within(modal).getByText('Choose at least one policy.')).toBeInTheDocument();
    expect(engine.of('AttachRolePolicy')).toEqual([]);

    pick(modal, 'p-01');
    const release = holdAnswers('AttachRolePolicy');
    const button = attachButton(modal);
    button.focus();
    fireEvent.click(button);
    // Cloudscape says a button's loading text in a live region beside it.
    expect(await within(modal).findByText('Attaching')).toBeInTheDocument();
    expect(attachButton(modal)).toHaveAttribute('aria-disabled', 'true');
    expect(within(modal).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(document.activeElement).toBe(attachButton(modal));
    expect(flashes).toEqual([]);

    act(() => {
      release();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('one attached → "Attached {policy} to {role}."; the dialog closes and focus returns to "Attach policies"', async () => {
    given();
    const modal = await openAttach();
    pick(modal, 'p-01');
    fireEvent.click(attachButton(modal));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(flashTexts()).toEqual(['Attached p-01 to app.']);
    expect(document.activeElement).toBe(action('Attach policies'));
    await waitFor(() => {
      expect(policyRow('p-01')).toBeInTheDocument();
    });
  });

  it('several → "Attached {n} policies to {role}.", sent one by one in the order chosen', async () => {
    given();
    const modal = await openAttach();
    pick(modal, 'p-05', 'p-01');
    fireEvent.click(attachButton(modal));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(flashTexts()).toEqual(['Attached 2 policies to app.']);
    expect(engine.of('AttachRolePolicy').map(({ params }) => params.get('PolicyArn'))).toEqual([
      customerPolicy('p-05').arn,
      customerPolicy('p-01').arn,
    ]);
  });

  it('the second of three refused → the dialog stays with "{policy} was not attached.", the code and message, "1 attached before it."; the role is read again', async () => {
    given();
    const modal = await openAttach();
    engine.handlers.AttachRolePolicy = (params) =>
      params.get('PolicyArn') === customerPolicy('p-02').arn
        ? refusal(409, 'LimitExceeded', 'Cannot exceed quota for PoliciesPerRole: 10')
        : engine.emulator('AttachRolePolicy', params);
    const reads = engine.of('GetRole').length;
    pick(modal, 'p-01', 'p-02', 'p-04');
    fireEvent.click(attachButton(modal));

    // The client's retries of a refusal it takes for throttling come first, with their back-off.
    const alert = await within(modal).findByText('p-02 was not attached.', {}, { timeout: 8000 });
    const box = alert.closest('[role="alert"], [class*="awsui_alert"]') ?? modal;
    expect(box).toHaveTextContent('LimitExceeded: Cannot exceed quota for PoliciesPerRole: 10');
    expect(box).toHaveTextContent('1 attached before it.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The client may retry a refusal the SDK takes for throttling; the policy after the refused one is never sent.
    expect([...new Set(engine.of('AttachRolePolicy').map(({ params }) => params.get('PolicyArn')))]).toEqual([
      customerPolicy('p-01').arn,
      customerPolicy('p-02').arn,
    ]);
    expect(flashes).toEqual([]);
    await waitFor(() => {
      expect(engine.of('GetRole').length).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      expect(choiceRow(modal, 'p-01')).toHaveTextContent('Attached');
    });
  }, 15_000);

  it.each([
    ['not implemented', () => refusal(501, 'NotImplemented', 'no'), 'Not implemented by the emulator'],
    [
      'access denied',
      () => refusal(403, 'AccessDenied', 'not for you'),
      'Access denied. AttachRolePolicy was refused: not for you',
    ],
    ['no answer', () => 'network-error' as const, 'did not answer'],
  ])('%s → its words', async (_, answer, words) => {
    given();
    const modal = await openAttach();
    engine.handlers.AttachRolePolicy = answer;
    pick(modal, 'p-01');
    fireEvent.click(attachButton(modal));

    await within(modal).findByText('p-01 was not attached.');
    expect(modal).toHaveTextContent(words);
    expect(modal).not.toHaveTextContent('attached before it');
  });

  it('Esc and "Cancel" close it and attach nothing', async () => {
    given();
    let modal = await openAttach();
    pick(modal, 'p-01');
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(action('Attach policies'));
    modal = await dialog();
    await within(modal).findByText('p-01');
    pick(modal, 'p-01');
    fireEvent.keyDown(within(modal).getByRole('button', { name: 'Cancel' }), { key: 'Escape', keyCode: 27 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(engine.of('AttachRolePolicy')).toEqual([]);
    expect(flashes).toEqual([]);
  });
});
