import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import type { IamFailure, NewPolicy } from '../api';
import { POLICY_SKELETON } from '../document-text';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/pages/create-policy-page.test.tsx" (issue 535). The page is
// rendered inside the area's layout, as Studio's frame renders it, with IAM's calls answered by the case.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, createPolicy: vi.fn(), getPolicy: vi.fn(), getPolicyDocument: vi.fn(), listPolicies: vi.fn() };
});

const createPolicy = vi.mocked(api.createPolicy);
const getPolicy = vi.mocked(api.getPolicy);
const getPolicyDocument = vi.mocked(api.getPolicyDocument);
const listPolicies = vi.mocked(api.listPolicies);

const NEW_ARN = 'arn:aws:iam::000000000000:policy/p-new';
const DOC_A =
  '{\n  "Version": "2012-10-17",\n  "Statement":  [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]\n}';
const NAME_CONSTRAINT = '1 to 128 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.';

const EMULATOR_PORT = 9313;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

let nextPort = 9350;
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
  createPolicy.mockReset();
  getPolicy.mockReset();
  getPolicyDocument.mockReset();
  listPolicies.mockReset();
  createPolicy.mockResolvedValue(NEW_ARN);
  getPolicy.mockImplementation((_endpoint, arn) =>
    Promise.resolve({
      kind: 'found',
      policy: { name: 'p-new', arn, type: 'Customer managed', defaultVersionId: 'v1' },
      versions: { kind: 'read', items: [{ id: 'v1', isDefault: true }] },
      entities: { kind: 'read', items: [] },
    }),
  );
  getPolicyDocument.mockResolvedValue({ kind: 'found', text: DOC_A, versionId: 'v1', isDefault: true });
  listPolicies.mockResolvedValue({ policies: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], {
    initialEntries: ['/aws/iam/policies/create'],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function opened() {
  await screen.findByRole('heading', { level: 1, name: 'Create policy' }, { timeout: 10_000 });
}

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Policy name' }) as HTMLInputElement;
}

function descriptionField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement;
}

function documentField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Policy document' }) as HTMLTextAreaElement;
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create policy' }));
}

function cancel() {
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
}

describe('"Create policy"', () => {
  it('shows the name’s and the description’s constraint texts from the start, and the document starts with the skeleton', async () => {
    open();
    await opened();

    expect(screen.getByText(NAME_CONSTRAINT)).toBeTruthy();
    expect(screen.getByText('Up to 1000 characters.')).toBeTruthy();
    expect(documentField().value).toBe(POLICY_SKELETON);
    expect(nameField().value).toBe('');
    expect(descriptionField().value).toBe('');
  });

  it.each([
    ['an empty name', '', 'Enter a policy name.'],
    ['a name of 129 characters', 'a'.repeat(129), 'The name can have up to 128 characters.'],
    ['a name with a space', 'p bad', 'The name can have only letters, digits and the characters + = , . @ _ -.'],
  ])('shows the message of %s at its field and sends nothing', async (_case, name, message) => {
    open();
    await opened();
    type(nameField(), name);
    submit();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('accepts a name of 128 characters', async () => {
    open();
    await opened();
    type(nameField(), 'a'.repeat(128));
    submit();

    await waitFor(() => {
      expect(createPolicy).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the message of a description of 1001 characters and sends nothing', async () => {
    open();
    await opened();
    type(nameField(), 'p-new');
    type(descriptionField(), 'd'.repeat(1001));
    submit();

    expect(await screen.findByText('The description can have up to 1000 characters.')).toBeTruthy();
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('shows the message of a text that is not JSON and sends nothing', async () => {
    open();
    await opened();
    type(nameField(), 'p-new');
    type(documentField(), '{"Version": ');
    submit();

    expect(await screen.findByText('Enter the policy as one JSON value.')).toBeTruthy();
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('shows each field its message when several are wrong at once', async () => {
    open();
    await opened();
    type(descriptionField(), 'd'.repeat(1001));
    type(documentField(), 'not json');
    submit();

    expect(await screen.findByText('Enter a policy name.')).toBeTruthy();
    expect(screen.getByText('The description can have up to 1000 characters.')).toBeTruthy();
    expect(screen.getByText('Enter the policy as one JSON value.')).toBeTruthy();
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('sends one request with the name and the text as typed, and no description when it is empty', async () => {
    open();
    await opened();
    type(nameField(), 'p-new');
    type(documentField(), DOC_A);
    submit();

    await waitFor(() => {
      expect(createPolicy).toHaveBeenCalledTimes(1);
    });
    const sent = createPolicy.mock.calls[0]?.[1] as NewPolicy;
    expect(sent).toEqual({ name: 'p-new', document: DOC_A });
  });

  it('sends the description when it is not empty', async () => {
    open();
    await opened();
    type(nameField(), 'p-new');
    type(descriptionField(), 'made in studio');
    submit();

    await waitFor(() => {
      expect(createPolicy).toHaveBeenCalledTimes(1);
    });
    expect(createPolicy.mock.calls[0]?.[1]).toEqual({
      name: 'p-new',
      description: 'made in studio',
      document: POLICY_SKELETON,
    });
  });

  it('says "Creating the policy" with the button unavailable while in flight, and sends nothing more', async () => {
    createPolicy.mockImplementation(() => new Promise(() => undefined));
    open();
    await opened();
    type(nameField(), 'p-new');
    submit();

    const button = await screen.findByRole('button', { name: /Creating the policy/ });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });

  it('opens the new policy’s page with "Policy {name} created." on success', async () => {
    const router = open();
    await opened();
    type(nameField(), 'p-new');
    submit();

    expect(await screen.findByText('Policy p-new created.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/aws/iam/policies/details');
    expect(new URLSearchParams(router.state.location.search).get('arn')).toBe(NEW_ARN);
    expect(await screen.findByRole('heading', { level: 2, name: 'Policy details' })).toBeTruthy();
  });

  it.each<[string, IamFailure, string]>([
    [
      'a refusal',
      { kind: 'other', operation: 'CreatePolicy', code: 'EntityAlreadyExists', message: 'p-new exists' },
      'EntityAlreadyExists: p-new exists',
    ],
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'CreatePolicy' },
      'The emulator answered 501 Not Implemented for CreatePolicy.',
    ],
    [
      'access denied',
      { kind: 'access-denied', operation: 'CreatePolicy', message: 'not allowed' },
      'CreatePolicy was refused: not allowed',
    ],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'CreatePolicy', message: 'timed out' },
      'The emulator did not answer',
    ],
    ['the engine not answering', { kind: 'engine-did-not-answer', operation: 'CreatePolicy' }, 'did not answer'],
  ])('keeps the form with %s in its words', async (_case, failure, words) => {
    createPolicy.mockRejectedValue(new api.IamError(failure));
    const router = open();
    await opened();
    type(nameField(), 'p-new');
    type(documentField(), DOC_A);
    submit();

    await waitFor(() => {
      expect(screen.getByRole('main').textContent).toContain(words);
    });
    expect(router.state.location.pathname).toBe('/aws/iam/policies/create');
    expect(nameField().value).toBe('p-new');
    expect(documentField().value).toBe(DOC_A);
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });

  it('leads to the list at once on "Cancel" with nothing changed', async () => {
    const router = open();
    await opened();
    cancel();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies');
    });
    expect(screen.queryByText('Discard what you entered?')).toBeNull();
  });

  it('asks "Discard what you entered?" with a field changed: "Keep editing" keeps the form, "Discard" leads to the list and sends nothing', async () => {
    const router = open();
    await opened();
    type(nameField(), 'p-typed');
    type(descriptionField(), 'kept');
    cancel();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard what you entered?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(nameField().value).toBe('p-typed');
    expect(descriptionField().value).toBe('kept');
    expect(router.state.location.pathname).toBe('/aws/iam/policies/create');

    cancel();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies');
    });
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('asks too when only the document changed', async () => {
    open();
    await opened();
    type(documentField(), DOC_A);
    cancel();

    expect(await screen.findByText('Discard what you entered?')).toBeTruthy();
  });

  it('does not ask for a name typed and removed again', async () => {
    const router = open();
    await opened();
    type(nameField(), 'p-x');
    type(nameField(), '');
    cancel();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies');
    });
    expect(screen.queryByText('Discard what you entered?')).toBeNull();
  });
});
