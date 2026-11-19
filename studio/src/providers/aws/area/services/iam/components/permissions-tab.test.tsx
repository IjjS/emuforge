import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import type { Role, RolePolicies } from '../api';
import { RolePage } from '../pages/role-page';
import { PermissionsTab } from './permissions-tab';

// Test criteria, "Unit s2 — providers/aws/area/services/iam/components/permissions-tab.test.tsx" (issue 535, task 1):
// the tab rendered on its own against a fake engine behind `fetch`, which answers the document reads.

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ok(action: string, result: string): Response {
  return new Response(
    `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
    { status: 200, headers: { 'content-type': 'text/xml' } },
  );
}

function refusal(status: number, code: string, message: string): Response {
  return new Response(
    `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
    { status, headers: { 'content-type': 'text/xml' } },
  );
}

const INLINE_TEXT = '{\n  "Version": "2012-10-17",\n  "Statement":  [{"Effect": "Allow", "Action": "s3:PutObject"}]\n}';
const MANAGED_TEXT =
  '{\n  "Version": "2012-10-17",\n  "Statement": [{"Effect": "Allow",  "Action": "s3:GetObject"}]\n}';
const OWN = { kind: 'managed', name: 'team-read', arn: 'arn:aws:iam::000000000000:policy/team-read' } as const;
const ABSENT = { kind: 'managed', name: 'p-absent', arn: 'arn:aws:iam::aws:policy/p-absent' } as const;
const INLINE = { kind: 'inline', name: 'inline-one' } as const;

interface Sent {
  action: string;
  params: URLSearchParams;
}

let sent: Sent[];
let port = 9450;
let connection: AreaConnection;

/** The emulator's answer to a document read: the inline policy, the customer managed one; nothing else is held. */
function answer(action: string, params: URLSearchParams): Response {
  switch (action) {
    case 'GetRolePolicy':
      return params.get('PolicyName') === INLINE.name
        ? ok(
            action,
            `<RoleName>r</RoleName><PolicyName>${INLINE.name}</PolicyName><PolicyDocument>${esc(encodeURIComponent(INLINE_TEXT))}</PolicyDocument>`,
          )
        : refusal(404, 'NoSuchEntity', 'no such policy');
    case 'GetPolicy':
      return params.get('PolicyArn') === OWN.arn
        ? ok(
            action,
            `<Policy><PolicyName>${OWN.name}</PolicyName><Arn>${OWN.arn}</Arn><DefaultVersionId>v2</DefaultVersionId></Policy>`,
          )
        : refusal(404, 'NoSuchEntity', `Policy ${params.get('PolicyArn') ?? ''} does not exist.`);
    case 'GetPolicyVersion':
      return ok(
        action,
        `<PolicyVersion><Document>${esc(encodeURIComponent(MANAGED_TEXT))}</Document><VersionId>v2</VersionId><IsDefaultVersion>true</IsDefaultVersion></PolicyVersion>`,
      );
    default:
      return refusal(400, 'InvalidAction', action);
  }
}

beforeEach(() => {
  sent = [];
  port += 1;
  connection = { result: undefined, engineOrigin: engineEndpoint(port) };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 't' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    sent.push({ action, params });
    return answer(action, params);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROLE: Role = { name: 'team-role', path: '/', tags: [] };

function show(policies: RolePolicies, role: Role = ROLE, onRetry: () => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PermissionsTab role={role} policies={policies} connection={connection} onRetry={onRetry} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const ALL: RolePolicies = { kind: 'read', items: [OWN, ABSENT, INLINE], truncated: false };

function table() {
  const found = createWrapper(document.body).findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

/** The row whose name cell reads `name`. */
function row(name: string): HTMLElement {
  const found = table()
    .findRows()
    .map((wrapper) => wrapper.getElement())
    .find((element) => (element.querySelectorAll('th, td')[1]?.textContent ?? '').trim() === name);
  expect(found, name).toBeDefined();
  return found as HTMLElement;
}

function documentOf(name: string): string | undefined {
  return row(name).querySelector('.aws-iam-policy-document')?.textContent ?? undefined;
}

function toggle(name: string, label: 'Show document' | 'Hide document') {
  fireEvent.click(within(row(name)).getByRole('button', { name: `${label} of ${name}` }));
}

describe('the policies', () => {
  it('listed with name and type; a managed name links to its page by its ARN, an inline one is text; no document is requested', () => {
    show(ALL);

    expect(
      table()
        .findRows()
        .map((wrapper) =>
          [...wrapper.getElement().querySelectorAll('th, td')]
            .slice(1, 3)
            .map((cell) => (cell.textContent ?? '').trim()),
        ),
    ).toEqual([
      ['team-read', 'Customer managed'],
      ['p-absent', 'AWS managed'],
      ['inline-one', 'Customer inline'],
    ]);
    expect(within(row('team-read')).getByRole('link', { name: 'team-read' })).toHaveAttribute(
      'href',
      `/aws/iam/policies/details?arn=${encodeURIComponent(OWN.arn)}`,
    );
    expect(within(row('inline-one')).queryByRole('link')).toBeNull();
    expect(document.querySelector('.aws-iam-policy-document')).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('"Show document"', () => {
  it('of an inline row reads that policy and shows its text; "Hide document" puts it away', async () => {
    show(ALL);

    toggle('inline-one', 'Show document');

    await waitFor(() => {
      expect(documentOf('inline-one')).toBe(INLINE_TEXT);
    });
    expect(sent.map(({ action, params }) => [action, params.get('RoleName'), params.get('PolicyName')])).toEqual([
      ['GetRolePolicy', 'team-role', 'inline-one'],
    ]);
    expect(within(row('inline-one')).getByRole('button', { name: 'Hide document of inline-one' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    toggle('inline-one', 'Hide document');

    expect(documentOf('inline-one')).toBeUndefined();
    expect(within(row('inline-one')).getByRole('button', { name: 'Show document of inline-one' })).toBeInTheDocument();
  });

  it('of a managed row reads its default version and shows its text', async () => {
    show(ALL);

    toggle('team-read', 'Show document');

    await waitFor(() => {
      expect(documentOf('team-read')).toBe(MANAGED_TEXT);
    });
    expect(sent.map(({ action }) => action)).toEqual(['GetPolicy', 'GetPolicyVersion']);
    expect(sent[1]?.params.get('VersionId')).toBe('v2');
  });

  it('two rows open at once each show their own; hiding one leaves the other', async () => {
    show(ALL);

    toggle('team-read', 'Show document');
    toggle('inline-one', 'Show document');

    await waitFor(() => {
      expect(documentOf('team-read')).toBe(MANAGED_TEXT);
      expect(documentOf('inline-one')).toBe(INLINE_TEXT);
    });

    toggle('inline-one', 'Hide document');

    expect(documentOf('inline-one')).toBeUndefined();
    expect(documentOf('team-read')).toBe(MANAGED_TEXT);
  });

  it('a managed policy the emulator does not hold: "Policy not found" for that row, the row and the others as they were', async () => {
    show(ALL);
    toggle('team-read', 'Show document');
    await waitFor(() => {
      expect(documentOf('team-read')).toBe(MANAGED_TEXT);
    });

    toggle('p-absent', 'Show document');

    await waitFor(() => {
      expect(within(row('p-absent')).getByText('Policy not found')).toBeInTheDocument();
    });
    expect(row('p-absent')).toHaveTextContent(`The emulator holds no policy with the ARN ${ABSENT.arn}.`);
    expect(table().findRows()).toHaveLength(3);
    expect(documentOf('team-read')).toBe(MANAGED_TEXT);
    expect(within(row('inline-one')).queryByText('Policy not found')).toBeNull();
  });

  it('a document with markup is shown as text', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      }
      return ok(
        'GetRolePolicy',
        `<PolicyDocument>${esc(encodeURIComponent('{"Sid": "<img src=x onerror=alert(1)>"}'))}</PolicyDocument>`,
      );
    });
    show(ALL);

    toggle('inline-one', 'Show document');

    await waitFor(() => {
      expect(documentOf('inline-one')).toBe('{"Sid": "<img src=x onerror=alert(1)>"}');
    });
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('"Permissions boundary" and the failed lists', () => {
  it('"Permissions boundary" shows the boundary’s ARN with its copy control, or "Not set"', () => {
    const boundary = 'arn:aws:iam::aws:policy/PowerUserAccess';
    const { unmount } = show(ALL, { ...ROLE, permissionsBoundary: boundary });
    expect(screen.getByRole('heading', { level: 2, name: 'Permissions boundary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Permissions boundary' })).toBeInTheDocument();
    expect([...document.querySelectorAll('.aws-area-value')].map((value) => value.textContent)).toContain(boundary);
    unmount();

    show(ALL);
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Permissions boundary' })).toBeNull();
  });

  it('a failed list: its state in the table’s place, the heading and columns kept, "Retry" asks the page to read again', () => {
    const onRetry = vi.fn<() => void>();
    show(
      {
        kind: 'failed',
        failure: { kind: 'other', operation: 'ListAttachedRolePolicies', code: 'ValidationError', message: 'bad list' },
      },
      ROLE,
      onRetry,
    );

    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    expect(slot).toHaveTextContent('The policies could not be read');
    expect(slot).toHaveTextContent('ValidationError: bad list');
    expect(
      table()
        .findColumnHeaders()
        .map((header) => (header.getElement().textContent ?? '').trim()),
    ).toEqual(['Policy selection', 'Policy name', 'Type', 'Document']);
    expect(screen.getByRole('heading', { level: 2, name: 'Permissions policies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Permissions boundary' })).toBeInTheDocument();

    fireEvent.click(within(slot).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a list answered 501: "Not implemented by the emulator" naming the operation and the policies', () => {
    show({ kind: 'failed', failure: { kind: 'not-implemented', operation: 'ListRolePolicies' } });

    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    expect(slot).toHaveTextContent('Not implemented by the emulator');
    expect(slot).toHaveTextContent(
      'The emulator answered 501 Not Implemented for ListRolePolicies, so Studio cannot show the policies.',
    );
  });

  it('no policy: "No policies"; a truncated list: "More policies exist than are shown."', () => {
    const { unmount } = show({ kind: 'read', items: [], truncated: false });
    expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No policies');
    unmount();

    show({ kind: 'read', items: [INLINE], truncated: true });
    expect(screen.getByText('More policies exist than are shown.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Test criteria, "Unit s3 — providers/aws/area/services/iam/components/permissions-tab.test.tsx" (issue 535, task 3):
// the changes' controls, and the role read again after every refused change.
// ---------------------------------------------------------------------------------------------------------------

const SERVICE_LINKED_REASON = "The emulator does not let a service-linked role's policies or trust policy be changed.";

/** The button named `name` is unavailable: disabled, or disabled with a reason and still focusable. */
function expectUnavailable(name: string, reason?: string) {
  const button = screen.getByRole('button', { name });
  expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true', name).toBe(true);
  if (reason !== undefined) {
    expect(button).toHaveAccessibleDescription(reason);
  }
}

function expectAvailable(name: string) {
  const button = screen.getByRole('button', { name });
  expect(button, name).not.toHaveAttribute('disabled');
  expect(button, name).not.toHaveAttribute('aria-disabled', 'true');
}

function chooseRow(name: string) {
  fireEvent.click(within(row(name)).getByRole('radio'));
}

describe('the changes of the chosen row', () => {
  it('"Detach" for a managed row, unavailable for an inline one; "Edit" and "Delete" the other way round', () => {
    show(ALL);

    expectAvailable('Attach policies');
    expectAvailable('Add inline policy');
    for (const name of ['Detach', 'Edit inline policy', 'Delete inline policy']) {
      expectUnavailable(name);
    }

    chooseRow('team-read');
    expectAvailable('Detach');
    expectUnavailable('Edit inline policy', 'A managed policy is changed on its own page.');
    expectUnavailable('Delete inline policy', 'A managed policy is changed on its own page.');

    chooseRow('inline-one');
    expectUnavailable('Detach', 'An inline policy is deleted, not detached.');
    expectAvailable('Edit inline policy');
    expectAvailable('Delete inline policy');
  });

  it('a service-linked role: the five are unavailable with the reason, and the documents can still be shown', async () => {
    show(ALL, { name: 'AWSServiceRoleForX', path: '/aws-service-role/x.amazonaws.com/', tags: [] });

    for (const choice of [undefined, 'team-read', 'inline-one']) {
      if (choice !== undefined) {
        chooseRow(choice);
      }
      for (const name of [
        'Attach policies',
        'Add inline policy',
        'Detach',
        'Edit inline policy',
        'Delete inline policy',
      ]) {
        expectUnavailable(name, SERVICE_LINKED_REASON);
      }
    }

    toggle(INLINE.name, 'Show document');
    await waitFor(() => {
      expect(documentOf(INLINE.name)).toBe(INLINE_TEXT);
    });
  });
});

// The role's page, against an engine whose role is deleted by the change it refuses: each refused change reads the
// role again, which then shows "Role not found".
describe('after every refused change', () => {
  const MANAGED = { name: 'team-read', arn: 'arn:aws:iam::000000000000:policy/team-read' };
  let gone: boolean;
  let roleReads: number;
  let flashes: FlashResult[];

  function pageAnswer(action: string, params: URLSearchParams): Response {
    if (action === 'ListPolicies') {
      return ok(
        action,
        `<Policies><member><PolicyName>other</PolicyName><Arn>arn:aws:iam::000000000000:policy/other</Arn></member></Policies><IsTruncated>false</IsTruncated>`,
      );
    }
    const missing = refusal(404, 'NoSuchEntity', `The role with name ${params.get('RoleName') ?? ''} cannot be found.`);
    if (gone) {
      return missing;
    }
    switch (action) {
      case 'GetRole':
        roleReads += 1;
        return ok(
          action,
          '<Role><Path>/</Path><RoleName>app</RoleName><RoleId>AROA1</RoleId><Arn>arn:aws:iam::000000000000:role/app</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><MaxSessionDuration>3600</MaxSessionDuration><RoleLastUsed/></Role>',
        );
      case 'ListAttachedRolePolicies':
        return ok(
          action,
          `<AttachedPolicies><member><PolicyName>${MANAGED.name}</PolicyName><PolicyArn>${MANAGED.arn}</PolicyArn></member></AttachedPolicies><IsTruncated>false</IsTruncated>`,
        );
      case 'ListRolePolicies':
        return ok(action, '<PolicyNames><member>held</member></PolicyNames><IsTruncated>false</IsTruncated>');
      case 'GetRolePolicy':
        return ok(
          action,
          `<RoleName>app</RoleName><PolicyName>held</PolicyName><PolicyDocument>${esc(encodeURIComponent('{"Version": "2012-10-17", "Statement": []}'))}</PolicyDocument>`,
        );
      default:
        // The change: the role was deleted elsewhere just before it arrived.
        gone = true;
        return missing;
    }
  }

  beforeEach(() => {
    gone = false;
    roleReads = 0;
    flashes = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      }
      const params = new URLSearchParams(await request.text());
      const action = params.get('Action') ?? '';
      sent.push({ action, params });
      return pageAnswer(action, params);
    });
  });

  function Page() {
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
            <RolePage connection={connection} params={{ name: 'app' }} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }

  async function openPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 2, name: 'Permissions policies' });
  }

  const steps: Record<string, (modal: () => Promise<HTMLElement>) => Promise<void>> = {
    attach: async (modal) => {
      fireEvent.click(screen.getByRole('button', { name: 'Attach policies' }));
      const open = await modal();
      fireEvent.click(await within(open).findByRole('checkbox', { name: 'other' }));
      fireEvent.click(within(open).getByRole('button', { name: 'Attach' }));
    },
    detach: async (modal) => {
      chooseRow(MANAGED.name);
      fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
      fireEvent.click(within(await modal()).getByRole('button', { name: 'Detach' }));
    },
    'add an inline policy': async (modal) => {
      fireEvent.click(screen.getByRole('button', { name: 'Add inline policy' }));
      const open = await modal();
      fireEvent.change(within(open).getByRole('textbox', { name: 'Policy name' }), { target: { value: 'fresh' } });
      fireEvent.click(within(open).getByRole('button', { name: 'Add policy' }));
    },
    'edit an inline policy': async (modal) => {
      chooseRow('held');
      fireEvent.click(screen.getByRole('button', { name: 'Edit inline policy' }));
      const open = await modal();
      await within(open).findByRole('textbox', { name: 'Policy document' });
      fireEvent.click(within(open).getByRole('button', { name: 'Save changes' }));
    },
    'delete an inline policy': async (modal) => {
      chooseRow('held');
      fireEvent.click(screen.getByRole('button', { name: 'Delete inline policy' }));
      const open = await modal();
      fireEvent.change(within(open).getByRole('textbox'), { target: { value: 'delete' } });
      fireEvent.click(within(open).getByRole('button', { name: 'Delete' }));
    },
  };

  it.each(Object.keys(steps))('%s refused → the role is read again, and "Role not found"', async (step) => {
    await openPage();
    const reads = roleReads;
    const run = steps[step];
    expect(run).toBeDefined();
    await (run as NonNullable<typeof run>)(() => screen.findByRole('dialog'));

    await waitFor(() => {
      expect(gone).toBe(true);
    });
    expect(await screen.findByText('Role not found')).toBeInTheDocument();
    expect(roleReads).toBe(reads);
    expect(sent.filter(({ action }) => action === 'GetRole').length).toBeGreaterThan(reads);
  });
});
