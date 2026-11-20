import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
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
const deletePolicy = vi.mocked(api.deletePolicy);
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
  // Each change of path is one route change, as Studio's frame counts them, so a result handed over is shown.
  const [seen, setSeen] = useState({ pathname, changes: 0 });
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
    deletePolicy,
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

// Fix s6 (issue 535, `.pm/issue-535/fix-s6.md`): "Edit" and its typed text outlive a failed read of the policy behind
// it; with no dialog open the page's read states are as before.
describe('"Edit" open while the policy’s read fails', () => {
  const TYPED = '{"Version": "2012-10-17", "Statement": [{"Effect": "Deny", "Action": "*", "Resource": "*"}]}';
  const STOPPED: IamFailure = {
    kind: 'emulator-did-not-answer',
    operation: 'GetPolicy',
    message: 'The emulator at https://127.0.0.1:9313 could not be reached',
  };

  /** The emulator stops answering: every call from now on fails so. */
  function emulatorStops() {
    const reject = () => Promise.reject(new api.IamError(STOPPED));
    getPolicy.mockImplementation(reject);
    getPolicyDocument.mockImplementation(reject);
    createPolicyVersion.mockImplementation(() =>
      Promise.reject(new api.IamError({ ...STOPPED, operation: 'CreatePolicyVersion' })),
    );
  }

  function editDialog(): HTMLElement {
    return screen.getByRole('dialog', { name: 'Edit p-doc' });
  }

  async function typedAndFailed() {
    open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit p-doc' });
    fireEvent.change(await within(dialog).findByRole('textbox', { name: /Policy document/ }), {
      target: { value: TYPED },
    });
    const reads = getPolicy.mock.calls.length;
    emulatorStops();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(editDialog()).toHaveTextContent('The emulator did not answer');
    });
    // The read the save starts has run and failed too.
    await waitFor(() => {
      expect(getPolicy.mock.calls.length).toBeGreaterThan(reads);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('the save fails as the emulator not answering, and the read after it too → the dialog stays with the text and the failure; the page is not its failure state', async () => {
    await typedAndFailed();

    expect((within(editDialog()).getByRole('textbox', { name: /Policy document/ }) as HTMLTextAreaElement).value).toBe(
      TYPED,
    );
    expect(editDialog()).toHaveTextContent(STOPPED.message);
    // The page's sections stay (a section's own read may show its failure, as on a refresh that fails in part).
    for (const heading of ['Policy details', 'Policy document', 'Versions']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('then closed ("Discard") → the page’s failure state for the read, with "Retry"', async () => {
    await typedAndFailed();

    fireEvent.click(within(editDialog()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Discard what you entered?' })).getByRole('button', {
        name: 'Discard',
      }),
    );

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit p-doc' })).toBeNull();
    expect(document.body.textContent).toContain('The emulator did not answer');
    expect(screen.queryByRole('heading', { level: 2, name: 'Policy details' })).toBeNull();
  });

  it('no dialog open: "Refresh policy" whose read fails → the failure state at once', async () => {
    open();
    await loaded();
    emulatorStops();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh policy' }));

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('The emulator did not answer');
    expect(screen.queryByRole('heading', { level: 2, name: 'Policy details' })).toBeNull();
  });
});

// Issue 551, "Unit s1": the result of "Delete" is shown once, whatever order the reads the deletion starts answer in.
// The page unmounts the dialog once the policy's read finds it gone, which may be before the read of its document.
describe('"Delete" of the policy, whatever order the reads after it answer in', () => {
  const GONE: IamFailure = {
    kind: 'other',
    operation: 'ListEntitiesForPolicy',
    code: 'NoSuchEntity',
    message: `Policy ${ARN} does not exist or is not attachable.`,
  };

  /** A read held until `release` is called; then it answers as `answer` says at that moment. */
  function holdReads<T>(answer: () => Promise<T>) {
    const waiting: (() => void)[] = [];
    let holding = true;
    const held = () =>
      holding
        ? new Promise<T>((resolve, reject) => {
            waiting.push(() => {
              answer().then(resolve, reject);
            });
          })
        : answer();
    const release = () => {
      holding = false;
      act(() => {
        for (const go of waiting.splice(0)) go();
      });
    };
    return { held, release, waiting: () => waiting.length };
  }

  /** Each read of a document waits; once released they answer from what the emulator holds. */
  function holdDocumentReads() {
    const answer = getPolicyDocument.getMockImplementation();
    expect(answer).toBeDefined();
    const hold = holdReads(() =>
      (answer as NonNullable<typeof answer>)(
        connection.engineOrigin ?? '',
        ARN,
        undefined,
        new AbortController().signal,
      ),
    );
    getPolicyDocument.mockImplementation(hold.held);
    return hold;
  }

  function flashItems(): string[] {
    return (PAGE.findFlashbar()?.findItems() ?? []).map((item) => text(item.getElement()));
  }

  async function confirmDelete() {
    fireEvent.click(headerButton('Delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete p-doc?' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    return dialog;
  }

  /** Lets every answer that is due arrive, so a result shown twice would be seen. */
  async function settled() {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function openShown() {
    const router = open();
    await loaded();
    await waitFor(() => {
      expect(documentText()).toBe(DOC_B);
    });
    return router;
  }

  it('deleted elsewhere, the policy’s read answers "not found" before the document’s → the failed step once, and "Policy not found"', async () => {
    await openShown();
    held = undefined;
    deletePolicy.mockResolvedValue({
      kind: 'failed',
      step: { kind: 'read-entities' },
      failure: GONE,
      detachedRoles: [],
    });
    const documents = holdDocumentReads();

    await confirmDelete();
    expect(await screen.findByText('Policy not found')).toBeInTheDocument();
    await waitFor(() => {
      expect(documents.waiting()).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('dialog', { name: 'Delete p-doc?' })).toBeNull();

    documents.release();
    await waitFor(() => {
      expect(flashItems()).toHaveLength(1);
    });
    await settled();
    const items = flashItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Reading what the policy is attached to failed');
    expect(items[0]).toContain('NoSuchEntity');
    expect(screen.getByText('Policy not found')).toBeInTheDocument();
    expect(deletePolicy).toHaveBeenCalledTimes(1);
  });

  it('deleted elsewhere, the document’s read answers before the policy’s → the same item once, and "Policy not found"', async () => {
    await openShown();
    held = undefined;
    deletePolicy.mockResolvedValue({
      kind: 'failed',
      step: { kind: 'read-entities' },
      failure: GONE,
      detachedRoles: [],
    });
    const answer = getPolicy.getMockImplementation() as NonNullable<ReturnType<typeof getPolicy.getMockImplementation>>;
    const policies = holdReads(() => answer(connection.engineOrigin ?? '', ARN, new AbortController().signal));
    getPolicy.mockImplementation(policies.held);
    const documentReads = getPolicyDocument.mock.calls.length;

    await confirmDelete();
    await waitFor(() => {
      expect(policies.waiting()).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(getPolicyDocument.mock.calls.length).toBeGreaterThan(documentReads);
    });
    await settled();

    policies.release();
    expect(await screen.findByText('Policy not found')).toBeInTheDocument();
    await waitFor(() => {
      expect(flashItems()).toHaveLength(1);
    });
    await settled();
    const items = flashItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Reading what the policy is attached to failed');
    expect(items[0]).toContain('NoSuchEntity');
    expect(screen.getByText('Policy not found')).toBeInTheDocument();
  });

  it('deleted by "Delete", the policy’s read answers "not found" before the document’s → the policy list with "Policy p-doc deleted." once', async () => {
    const router = await openShown();
    deletePolicy.mockImplementation(() => {
      held = undefined;
      return Promise.resolve({ kind: 'deleted', detachedRoles: ['p-r'] });
    });
    const documents = holdDocumentReads();

    await confirmDelete();
    await waitFor(() => {
      expect(documents.waiting()).toBeGreaterThan(0);
    });
    expect(await screen.findByText('Policy not found')).toBeInTheDocument();

    documents.release();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies');
    });
    await waitFor(() => {
      expect(flashItems()).toEqual(['Policy p-doc deleted.']);
    });
    await settled();
    expect(flashItems()).toEqual(['Policy p-doc deleted.']);
    expect(router.state.location.pathname).toBe('/aws/iam/policies');
  });

  it('the deletion’s request fails (the engine cannot be reached), the policy’s read ending first → "Deleting the policy" with the failure once', async () => {
    await openShown();
    deletePolicy.mockRejectedValue(new TypeError('Failed to fetch'));
    const documents = holdDocumentReads();
    const policyReads = getPolicy.mock.calls.length;

    await confirmDelete();
    await waitFor(() => {
      expect(getPolicy.mock.calls.length).toBeGreaterThan(policyReads);
    });
    await waitFor(() => {
      expect(documents.waiting()).toBeGreaterThan(0);
    });
    await settled();

    documents.release();
    await waitFor(() => {
      expect(flashItems()).toHaveLength(1);
    });
    await settled();
    const items = flashItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Deleting the policy failed');
    expect(items[0]).toContain('Failed to fetch');
    expect(screen.queryByRole('dialog', { name: 'Delete p-doc?' })).toBeNull();
  });

  it('while the deletion is in flight → the dialog stays, its "Delete" in progress, and no result is shown', async () => {
    await openShown();
    deletePolicy.mockImplementation(() => new Promise(() => undefined));
    const policyReads = getPolicy.mock.calls.length;

    const dialog = await confirmDelete();
    await settled();

    expect(screen.getByRole('dialog', { name: 'Delete p-doc?' })).toBe(dialog);
    const button = createWrapper(dialog)
      .findAllButtons()
      .find((found) => text(found.getElement()) === 'Delete');
    expect(button).toBeDefined();
    expect(button?.isDisabled()).toBe(true);
    expect(button?.findLoadingIndicator()).not.toBeNull();
    expect(flashItems()).toEqual([]);
    expect(getPolicy.mock.calls.length).toBe(policyReads);
    expect(deletePolicy).toHaveBeenCalledTimes(1);
  });
});
