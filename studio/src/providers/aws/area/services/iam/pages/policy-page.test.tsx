import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import type { IamFailure, PolicyEntity, PolicyPart, PolicyRead, PolicyVersion } from '../api';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/pages/policy-page.test.tsx" (issue 535). The page is
// rendered inside the area's layout, as Studio's frame renders it, with IAM's calls answered from the case's policy.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    getPolicy: vi.fn(),
    getPolicyDocument: vi.fn(),
    setDefaultPolicyVersion: vi.fn(),
    deletePolicyVersion: vi.fn(),
    createPolicyVersion: vi.fn(),
    deletePolicy: vi.fn(),
    getRole: vi.fn(),
  };
});

const getPolicy = vi.mocked(api.getPolicy);
const getPolicyDocument = vi.mocked(api.getPolicyDocument);
const setDefaultPolicyVersion = vi.mocked(api.setDefaultPolicyVersion);
const deletePolicyVersion = vi.mocked(api.deletePolicyVersion);
const createPolicyVersion = vi.mocked(api.createPolicyVersion);
const getRole = vi.mocked(api.getRole);

const ARN = 'arn:aws:iam::000000000000:policy/p-doc';
const AWS_ARN = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
const DOC_A =
  '{\n  "Version": "2012-10-17",\n  "Statement":  [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]\n}';
const DOC_B =
  '{\n  "Version": "2012-10-17",\n  "Statement":  [{"Effect": "Allow", "Action": "s3:PutObject", "Resource": "*"}]\n}';

/** The policy the emulator holds; `undefined` for none. */
interface HeldPolicy {
  arn: string;
  name: string;
  description?: string;
  defaultVersion: string;
  /** Each version's document, newest first. */
  documents: { id: string; text: string }[];
  entities: PolicyEntity[];
  versionsFailure?: IamFailure;
  entitiesFailure?: IamFailure;
}

let held: HeldPolicy | undefined;

function holdDoc(): HeldPolicy {
  return {
    arn: ARN,
    name: 'p-doc',
    description: '<img src=x onerror=alert(1)>',
    defaultVersion: 'v2',
    documents: [
      { id: 'v2', text: DOC_B },
      { id: 'v1', text: DOC_A },
    ],
    entities: [
      { kind: 'role', name: 'p-r' },
      { kind: 'user', name: 'p-u' },
      { kind: 'group', name: 'p-g' },
    ],
  };
}

function readOf(policy: HeldPolicy): PolicyRead {
  const versions: PolicyPart<PolicyVersion> =
    policy.versionsFailure === undefined
      ? {
          kind: 'read',
          items: policy.documents.map((document) => ({
            id: document.id,
            isDefault: document.id === policy.defaultVersion,
            createDate: new Date('2026-11-18T08:00:00Z'),
          })),
        }
      : { kind: 'failed', failure: policy.versionsFailure };
  const entities: PolicyPart<PolicyEntity> =
    policy.entitiesFailure === undefined
      ? { kind: 'read', items: policy.entities }
      : { kind: 'failed', failure: policy.entitiesFailure };
  return {
    kind: 'found',
    policy: {
      name: policy.name,
      arn: policy.arn,
      type: policy.arn.split(':')[4] === 'aws' ? 'AWS managed' : 'Customer managed',
      ...(policy.description === undefined ? {} : { description: policy.description }),
      createDate: new Date('2026-11-17T09:05:03Z'),
      updateDate: new Date('2026-11-18T10:20:30Z'),
      defaultVersionId: policy.defaultVersion,
    },
    versions,
    entities,
  };
}

function answerFromHeld() {
  getPolicy.mockImplementation((_endpoint, arn) =>
    Promise.resolve(held !== undefined && held.arn === arn ? readOf(held) : { kind: 'not-found' }),
  );
  getPolicyDocument.mockImplementation((_endpoint, arn, versionId) => {
    if (held === undefined || held.arn !== arn) {
      return Promise.resolve({ kind: 'not-found' });
    }
    const id = versionId ?? held.defaultVersion;
    const document = held.documents.find((found) => found.id === id);
    return Promise.resolve(
      document === undefined
        ? { kind: 'not-found' }
        : { kind: 'found', text: document.text, versionId: id, isDefault: id === held.defaultVersion },
    );
  });
  setDefaultPolicyVersion.mockImplementation((_endpoint, _arn, versionId) => {
    if (held !== undefined) held.defaultVersion = versionId;
    return Promise.resolve();
  });
  deletePolicyVersion.mockImplementation((_endpoint, _arn, versionId) => {
    if (held !== undefined) held.documents = held.documents.filter((document) => document.id !== versionId);
    return Promise.resolve();
  });
  createPolicyVersion.mockImplementation((_endpoint, _arn, text) => {
    if (held === undefined) return Promise.resolve('');
    const id = `v${String(held.documents.length + 1)}`;
    held.documents = [{ id, text }, ...held.documents];
    held.defaultVersion = id;
    return Promise.resolve(id);
  });
  getRole.mockImplementation(() => new Promise(() => undefined));
}

const EMULATOR_PORT = 9313;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

let nextPort = 9250;
let connection: AreaConnection;

function Area() {
  const { pathname } = useLocation();
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={pathname.length}
      connection={connection}
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
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('no network in this test')));
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  connection = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
  held = holdDoc();
  for (const mock of [
    getPolicy,
    getPolicyDocument,
    setDefaultPolicyVersion,
    deletePolicyVersion,
    createPolicyVersion,
  ]) {
    mock.mockReset();
  }
  answerFromHeld();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pathOf(arn: string): string {
  return `/aws/iam/policies/details?arn=${encodeURIComponent(arn)}`;
}

function open(path = pathOf(ARN)) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PAGE = createWrapper(document.body);

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The link "Policies" of "Policy not found", beside its words. */
function notFoundLink(): HTMLElement {
  let at: HTMLElement | null = screen.getByText('Policy not found');
  while (at !== null && within(at).queryByRole('link', { name: 'Policies' }) === null) {
    at = at.parentElement;
  }
  expect(at).not.toBeNull();
  return within(at as HTMLElement).getByRole('link', { name: 'Policies' });
}

async function loaded() {
  await screen.findByRole('heading', { level: 2, name: 'Policy details' }, { timeout: 10_000 });
}

function documentText(): string | null | undefined {
  return document.querySelector('.aws-iam-policy-document')?.textContent;
}

function versionsTable() {
  const found = PAGE.findAllTables().find((table) => text(table.findHeaderSlot()?.getElement()).includes('Versions'));
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

function entitiesTable() {
  const found = PAGE.findAllTables().find((table) =>
    text(table.findHeaderSlot()?.getElement()).includes('Attached to'),
  );
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

function rowsOf(table: ReturnType<typeof versionsTable>, skipFirst: boolean): string[][] {
  return (table.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].slice(skipFirst ? 1 : 0).map((cell) => text(cell)),
  );
}

function chooseVersion(id: string) {
  const index = rowsOf(versionsTable(), true).findIndex((row) => row[0] === id);
  expect(index).toBeGreaterThanOrEqual(0);
  act(() => {
    versionsTable()
      .findRowSelectionArea(index + 1)
      ?.click();
  });
}

function versionButton(name: string): HTMLElement {
  return within(versionsTable().findHeaderSlot()?.getElement() as HTMLElement).getByRole('button', { name });
}

function headerButton(name: string): HTMLElement {
  const h1 = screen.getByRole('heading', { level: 1 });
  const header = h1.closest('[class*="awsui_root"]')?.parentElement?.parentElement as HTMLElement;
  return within(header).getAllByRole('button', { name })[0] as HTMLElement;
}

async function showsReason(element: HTMLElement, reason: string) {
  fireEvent.focus(element);
  expect((await screen.findAllByText(reason)).length).toBeGreaterThan(0);
  fireEvent.blur(element);
}

function documentDescription(): string {
  return text(
    screen.getByRole('heading', { level: 2, name: 'Policy document' }).closest('[class*="awsui_root"]')?.parentElement,
  );
}

describe("a policy's page", () => {
  it('shows the policy in its sections', async () => {
    open();
    await loaded();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('p-doc');
    const details = text(document.body);
    expect(details).toContain(ARN);
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeTruthy();
    expect(details).toContain('Customer managed');
    expect(details).toContain('Created');
    expect(details).toContain('2026-11-17 09:05:03 UTC');
    expect(details).toContain('Last changed');
    expect(details).toContain('2026-11-18 10:20:30 UTC');
    expect(details).toContain('Default version');
    await waitFor(() => {
      expect(documentText()).toBe(DOC_B);
    });
    expect(documentDescription()).toContain('Version v2, the default.');
    expect(rowsOf(versionsTable(), true)).toEqual([
      ['v2', 'Yes', '2026-11-18 08:00:00 UTC'],
      ['v1', '-', '2026-11-18 08:00:00 UTC'],
    ]);
    expect(rowsOf(entitiesTable(), false)).toEqual([
      ['p-r', 'Role'],
      ['p-u', 'User'],
      ['p-g', 'Group'],
    ]);
    const roleLink = within(entitiesTable().getElement()).getByRole('link', { name: 'p-r' });
    expect(roleLink).toHaveAttribute('href', '/aws/iam/roles/details/p-r');
    expect(within(entitiesTable().getElement()).getAllByRole('link')).toHaveLength(1);
  });

  it('shows "-" for no description, and "Not attached" with its sentence when nothing has the policy', async () => {
    held = { ...holdDoc(), entities: [] };
    delete held.description;
    open();
    await loaded();

    const details = PAGE.findKeyValuePairs()?.getElement();
    const description = [...(details?.querySelectorAll('[class*="awsui_detail"], dd') ?? [])].map(text);
    expect(text(details)).toContain('Description');
    expect(description).toContain('-');
    const empty = entitiesTable().findEmptySlot()?.getElement() as HTMLElement;
    expect(within(empty).getByText('Not attached')).toBeTruthy();
    expect(within(empty).getByText('No role, user or group has this policy.')).toBeTruthy();
  });

  it('shows another version on "Show document", and the default again once that version is deleted', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(documentText()).toBe(DOC_B);
    });

    chooseVersion('v1');
    fireEvent.click(versionButton('Show document'));
    await waitFor(() => {
      expect(documentText()).toBe(DOC_A);
    });
    expect(documentDescription()).toContain('Version v1.');
    expect(documentDescription()).not.toContain('the default');

    fireEvent.click(versionButton('Delete'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(documentText()).toBe(DOC_B);
    });
    expect(documentDescription()).toContain('Version v2, the default.');
  });

  it('shows the default again once a new default is saved by "Edit"', async () => {
    open();
    await loaded();
    chooseVersion('v1');
    fireEvent.click(versionButton('Show document'));
    await waitFor(() => {
      expect(documentText()).toBe(DOC_A);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const field = await within(dialog).findByRole('textbox');
    fireEvent.change(field, { target: { value: '{"Version": "2012-10-17", "Statement": []}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('p-doc saved as version v3, now the default.')).toBeTruthy();
    await waitFor(() => {
      expect(documentText()).toBe('{"Version": "2012-10-17", "Statement": []}');
    });
    expect(documentDescription()).toContain('Version v3, the default.');
  });

  it('sets a version as the default with one request and reports it; unavailable for the default', async () => {
    open();
    await loaded();

    chooseVersion('v2');
    expect(versionButton('Set as default')).toHaveAttribute('aria-disabled', 'true');
    chooseVersion('v1');
    fireEvent.click(versionButton('Set as default'));

    expect(await screen.findByText('Version v1 is now the default of p-doc.')).toBeTruthy();
    expect(setDefaultPolicyVersion).toHaveBeenCalledTimes(1);
    expect(setDefaultPolicyVersion.mock.calls[0]?.slice(1, 3)).toEqual([ARN, 'v1']);
    await waitFor(() => {
      expect(documentText()).toBe(DOC_A);
    });
    expect(documentDescription()).toContain('Version v1, the default.');
  });

  it('keeps "Delete" of the default version unavailable with its reason; deletes another, confirmed by typing delete, with one request', async () => {
    open();
    await loaded();

    chooseVersion('v2');
    expect(versionButton('Delete')).toHaveAttribute('aria-disabled', 'true');
    await showsReason(versionButton('Delete'), 'The default version cannot be deleted.');

    chooseVersion('v1');
    fireEvent.click(versionButton('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete version v1?')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'This version of p-doc and its document are removed from the local emulator. This cannot be undone.',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(confirm);

    expect(await screen.findByText('Version v1 of p-doc deleted.')).toBeTruthy();
    expect(deletePolicyVersion).toHaveBeenCalledTimes(1);
    expect(deletePolicyVersion.mock.calls[0]?.slice(1, 3)).toEqual([ARN, 'v1']);
    await waitFor(() => {
      expect(rowsOf(versionsTable(), true).map((row) => row[0])).toEqual(['v2']);
    });
  });

  it('keeps "Edit", "Delete" and the versions’ actions of an AWS managed policy unavailable with its reason, its default version’s too', async () => {
    held = {
      arn: AWS_ARN,
      name: 'AWSLambdaBasicExecutionRole',
      defaultVersion: 'v1',
      documents: [{ id: 'v1', text: DOC_A }],
      entities: [],
    };
    open(pathOf(AWS_ARN));
    await loaded();
    await waitFor(() => {
      expect(documentText()).toBe(DOC_A);
    });
    expect(document.body.textContent).toContain('AWS managed');

    const reason = 'An AWS managed policy cannot be changed.';
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-disabled', 'true');
    await showsReason(screen.getByRole('button', { name: 'Edit' }), reason);
    expect(headerButton('Delete')).toHaveAttribute('aria-disabled', 'true');
    await showsReason(headerButton('Delete'), reason);
    chooseVersion('v1');
    expect(versionButton('Set as default')).toHaveAttribute('aria-disabled', 'true');
    expect(versionButton('Delete')).toHaveAttribute('aria-disabled', 'true');
    await showsReason(versionButton('Delete'), reason);
    expect(screen.queryByText('The default version cannot be deleted.')).toBeNull();
    expect(versionButton('Show document')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('says "Policy not found" with the link "Policies" for an address without an arn, and sends nothing', async () => {
    const router = open('/aws/iam/policies/details');

    expect(await screen.findByText('Policy not found', {}, { timeout: 10_000 })).toBeTruthy();
    expect(document.body.textContent).toContain('The emulator holds no policy with this ARN.');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Policy');
    expect(getPolicy).not.toHaveBeenCalled();
    fireEvent.click(notFoundLink());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies');
    });
  });

  it('says "Policy not found" for a policy the emulator does not hold', async () => {
    held = undefined;
    open();

    expect(await screen.findByText('Policy not found', {}, { timeout: 10_000 })).toBeTruthy();
    expect(notFoundLink()).toHaveAttribute('href', '/aws/iam/policies');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('p-doc');
  });

  it('says "Loading policy" while it is read', async () => {
    getPolicy.mockImplementation(() => new Promise(() => undefined));
    open();

    expect(await screen.findByText('Loading policy', {}, { timeout: 10_000 })).toBeTruthy();
  });

  it.each<[string, IamFailure, string]>([
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'GetPolicy' },
      'The emulator answered 501 Not Implemented for GetPolicy, so Studio cannot show the policy.',
    ],
    [
      'access denied',
      { kind: 'access-denied', operation: 'GetPolicy', message: 'not allowed' },
      'GetPolicy was refused: not allowed',
    ],
    [
      'the emulator did not answer',
      { kind: 'emulator-did-not-answer', operation: 'GetPolicy', message: 'timed out' },
      'The emulator did not answer',
    ],
    ['the engine did not answer', { kind: 'engine-did-not-answer', operation: 'GetPolicy' }, 'did not answer'],
    [
      'any other failure',
      { kind: 'other', operation: 'GetPolicy', code: 'ServiceFailure', message: 'broken' },
      'The policy could not be read',
    ],
  ])('shows %s with its retry', async (_name, failure, words) => {
    getPolicy.mockImplementation(() => Promise.reject(new api.IamError(failure)));
    open();

    await waitFor(
      () => {
        expect(document.body.textContent).toContain(words);
      },
      { timeout: 10_000 },
    );
    answerFromHeld();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
  });

  it('shows a failed versions or entities list as that section’s failure, the others shown', async () => {
    held = {
      ...holdDoc(),
      versionsFailure: { kind: 'other', operation: 'ListPolicyVersions', code: 'ServiceFailure', message: 'v' },
      entitiesFailure: { kind: 'access-denied', operation: 'ListEntitiesForPolicy', message: 'no entities' },
    };
    open();
    await loaded();

    expect(text(versionsTable().findEmptySlot()?.getElement())).toContain('The policy versions could not be read');
    expect(text(entitiesTable().findEmptySlot()?.getElement())).toContain(
      'ListEntitiesForPolicy was refused: no entities',
    );
    expect(document.body.textContent).toContain(ARN);
    await waitFor(() => {
      expect(documentText()).toBe(DOC_B);
    });
  });

  it('reads again on "Refresh policy" and reports "Policy refreshed"', async () => {
    open();
    await loaded();
    const reads = getPolicy.mock.calls.length;
    if (held !== undefined) held.entities = [];

    fireEvent.click(screen.getByRole('button', { name: 'Refresh policy' }));
    await waitFor(() => {
      expect(text(entitiesTable().findEmptySlot()?.getElement())).toContain('Not attached');
    });
    expect(getPolicy.mock.calls.length).toBe(reads + 1);
    await waitFor(() => {
      expect([...document.querySelectorAll('.aws-area-announcer')].map((region) => region.textContent)).toContain(
        'Policy refreshed',
      );
    });
  });

  it('shows a description with markup as text', async () => {
    open();
    await loaded();

    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
