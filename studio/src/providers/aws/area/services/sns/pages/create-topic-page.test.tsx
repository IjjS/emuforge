import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';

// S2 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine). The topic's page it leads to is s1's, its tabs replaced by stand-ins.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, createTopic: vi.fn(), getTopic: vi.fn(), listTopics: vi.fn() };
});

vi.mock('../components/subscriptions-tab', () => ({ SubscriptionsTab: () => <div data-testid="stand-in" /> }));
vi.mock('../components/publish-tab', () => ({ PublishTab: () => <div data-testid="stand-in" /> }));

const CREATE_PATH = '/aws/sns/topics/create';
const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const FIFO_ARN = 'arn:aws:sns:us-east-1:000000000000:jobs.fifo';
const STANDARD_RULE = '1 to 256 characters: letters, digits, hyphens and underscores.';
const FIFO_RULE = '1 to 256 characters: letters, digits, hyphens and underscores, ending with .fifo.';

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connection: AreaConnection = {
  result: { kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR } as CheckResult,
  engineOrigin: 'http://127.0.0.1:8309',
};

let router: ReturnType<typeof createMemoryRouter>;
const where = () => router.state.location.pathname;

function AreaWithStudioProps() {
  const location = useLocation();
  const [seen, setSeen] = useState({ pathname: location.pathname, changes: 0 });
  let changes = seen.changes;
  if (seen.pathname !== location.pathname) {
    changes += 1;
    setSeen({ pathname: location.pathname, changes });
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
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  vi.mocked(api.listTopics).mockResolvedValue({ arns: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [CREATE_PATH] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PAGE = createWrapper(document.body);

function nameField() {
  return fieldByLabel('Name');
}

/** The form field whose label is `label`. */
function fieldByLabel(label: string) {
  const field = PAGE.findAllFormFields().find((each) => each.findLabel()?.getElement().textContent === label);
  expect(field).toBeDefined();
  if (field === undefined) {
    throw new Error(`no field ${label}`);
  }
  return field;
}

/** The native input of the field `label`. */
function inputOf(label: string): HTMLInputElement {
  const input = fieldByLabel(label).getElement().querySelector('input');
  if (input === null) {
    throw new Error(`no input in ${label}`);
  }
  return input;
}

function type(label: string, value: string) {
  fireEvent.change(inputOf(label), { target: { value } });
}

function chooseKind(kind: 'standard' | 'fifo') {
  PAGE.findTiles()?.findInputByValue(kind)?.click();
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create topic' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create topic' })).toBeInTheDocument();
  });
}

describe('Create topic', () => {
  it('opens on "Standard" with the standard constraint text; "FIFO" → the FIFO constraint text and the checkbox', async () => {
    open();
    await opened();
    expect(PAGE.findTiles()?.findInputByValue('standard')?.getElement().checked).toBe(true);
    expect(fieldByLabel('Name').findConstraint()?.getElement().textContent).toBe(STANDARD_RULE);
    expect(screen.queryByText('Content-based deduplication')).not.toBeInTheDocument();
    chooseKind('fifo');
    expect(fieldByLabel('Name').findConstraint()?.getElement().textContent).toBe(FIFO_RULE);
    expect(screen.getByText('Content-based deduplication')).toBeInTheDocument();
    expect(PAGE.findCheckbox()?.findNativeInput().getElement().checked).toBe(false);
  });

  it('a name at fault → its message at the field and nothing sent; the constraint text stays', async () => {
    open();
    await opened();
    submit();
    expect(nameField().findError()?.getElement().textContent).toBe('Enter a name.');
    type('Name', 'my topic');
    submit();
    expect(nameField().findError()?.getElement().textContent).toBe(
      'A name can hold letters, digits, hyphens and underscores only.',
    );
    expect(nameField().findConstraint()?.getElement().textContent).toBe(STANDARD_RULE);
    chooseKind('fifo');
    type('Name', 'plain');
    submit();
    expect(nameField().findError()?.getElement().textContent).toBe("A FIFO topic's name ends with .fifo.");
    expect(nameField().findConstraint()?.getElement().textContent).toBe(FIFO_RULE);
    type('Name', 'ok.fifo');
    type('Display name - optional', 'x'.repeat(101));
    submit();
    expect(fieldByLabel('Display name - optional').findError()?.getElement().textContent).toBe(
      'The display name can have up to 100 characters.',
    );
    expect(api.createTopic).not.toHaveBeenCalled();
  });

  it('a standard topic with a display name → created with them; the topic opens with "Topic {name} is ready"', async () => {
    vi.mocked(api.createTopic).mockResolvedValue(ARN);
    vi.mocked(api.getTopic).mockResolvedValue({
      found: true,
      topic: { arn: ARN, displayName: 'Shown', fifo: false, contentBasedDeduplication: false },
    });
    open();
    await opened();
    type('Name', 'orders');
    type('Display name - optional', 'Shown');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Topic orders is ready')).toBeInTheDocument();
    });
    expect(vi.mocked(api.createTopic).mock.calls[0]?.[1]).toEqual({
      name: 'orders',
      displayName: 'Shown',
      fifo: false,
      contentBasedDeduplication: false,
    });
    expect(where()).toBe(`/aws/sns/topics/topic/${encodeURIComponent(ARN)}`);
  });

  it('a FIFO topic with content-based deduplication → created so', async () => {
    vi.mocked(api.createTopic).mockResolvedValue(FIFO_ARN);
    vi.mocked(api.getTopic).mockResolvedValue({
      found: true,
      topic: { arn: FIFO_ARN, fifo: true, contentBasedDeduplication: true },
    });
    open();
    await opened();
    chooseKind('fifo');
    type('Name', 'jobs.fifo');
    PAGE.findCheckbox()?.findNativeInput().click();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Topic jobs.fifo is ready')).toBeInTheDocument();
    });
    expect(vi.mocked(api.createTopic).mock.calls[0]?.[1]).toEqual({
      name: 'jobs.fifo',
      fifo: true,
      contentBasedDeduplication: true,
    });
  });

  it('a refusal → the form stays with the code and message', async () => {
    vi.mocked(api.createTopic).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'CreateTopic',
        code: 'InvalidParameter',
        message: 'Invalid parameter: Attributes Reason: Topic already exists with different attributes',
      }),
    );
    open();
    await opened();
    type('Name', 'orders');
    type('Display name - optional', 'Other');
    submit();
    await waitFor(() => {
      expect(screen.getByText('InvalidParameter')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Invalid parameter: Attributes Reason: Topic already exists with different attributes/),
    ).toBeInTheDocument();
    expect(where()).toBe(CREATE_PATH);
    expect(inputOf('Name').value).toBe('orders');
    expect(inputOf('Display name - optional').value).toBe('Other');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (arn: string) => void = () => undefined;
    vi.mocked(api.createTopic).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(api.getTopic).mockResolvedValue({
      found: true,
      topic: { arn: ARN, fifo: false, contentBasedDeduplication: false },
    });
    open();
    await opened();
    type('Name', 'orders');
    submit();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Creating/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Creating/ }));
    fireEvent.submit(screen.getByRole('button', { name: /Creating/ }).closest('form') as HTMLFormElement);
    expect(api.createTopic).toHaveBeenCalledTimes(1);
    finish(ARN);
    await waitFor(() => {
      expect(screen.getByText('Topic orders is ready')).toBeInTheDocument();
    });
  });

  it('"Cancel" with nothing entered → the topics list at once', async () => {
    open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(where()).toBe('/aws/sns/topics');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    open();
    await opened();
    type('Name', 'orders');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(where()).toBe(CREATE_PATH);
    expect(inputOf('Name').value).toBe('orders');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(where()).toBe('/aws/sns/topics');
    });
  });

  it('"Cancel" after choosing FIFO alone → the discard dialog', async () => {
    open();
    await opened();
    chooseKind('fifo');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
  });
});
