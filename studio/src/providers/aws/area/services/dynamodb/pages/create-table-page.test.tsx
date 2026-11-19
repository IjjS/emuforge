import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import { CreateTablePage } from './create-table-page';

// DynamoDB's "Create table", S3, rendered inside the area's layout as Studio's frame renders the area, against a fake
// engine behind the page's `fetch` that answers DynamoDB's JSON 1.0 protocol (issue 496, test-criteria.md, "Unit s2 —
// .../dynamodb/pages/create-table-page.test.tsx").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

interface Answer {
  status: number;
  body: unknown;
}

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

function refused(status: number, code: string, message: string): Answer {
  return { status, body: { __type: `com.amazonaws.dynamodb.v20120810#${code}`, message } };
}

class FakeEngine {
  readonly sent: Sent[] = [];
  /** The answer to `CreateTable`; by default the emulator's acceptance. */
  createAnswer: () => Answer | Promise<Answer> = () => ({ status: 200, body: { TableDescription: {} } });

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-496' }), { status: 200 });
    }
    const operation = (request.headers.get('x-amz-target') ?? '').replace('DynamoDB_20120810.', '');
    const body = JSON.parse((await request.text()) || '{}') as Record<string, unknown>;
    this.sent.push({ operation, body });
    const answer = operation === 'CreateTable' ? await this.createAnswer() : { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/x-amz-json-1.0' },
    });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

const EMULATOR_PORT = 9307;

function connectedResult(): CheckResult {
  return {
    kind: 'connected',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: `https://127.0.0.1:${String(EMULATOR_PORT)}` },
  };
}

let nextPort = 9700;
let engine: FakeEngine;
let connection: AreaConnection;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
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
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  connection = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CREATE_PATH = '/aws/dynamodb/tables/create';

function open() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [CREATE_PATH] },
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
// Readers and writers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The form's field labelled `label` (a label's text, without "- optional"). */
function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => {
    const shown = each.findLabel()?.getElement();
    return shown !== undefined && text(shown).replace(/ - optional$/, '') === label;
  });
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

function input(label: string): HTMLInputElement {
  return field(label).findControl()?.findInput()?.findNativeInput().getElement() as HTMLInputElement;
}

function type(label: string, value: string) {
  act(() => {
    field(label).findControl()?.findInput()?.setInputValue(value);
  });
}

function chooseKeyType(label: 'Partition key' | 'Sort key', value: 'S' | 'N' | 'B') {
  const select = () => field(label).findSecondaryControl()?.findSelect();
  act(() => {
    select()?.openDropdown();
  });
  act(() => {
    select()?.selectOptionByValue(value);
  });
}

function chooseMode(value: 'on-demand' | 'provisioned') {
  act(() => {
    field('Capacity mode').findControl()?.findRadioGroup()?.findInputByValue(value)?.click();
  });
}

function messageOf(label: string): string | undefined {
  const error = field(label).findError()?.getElement();
  return error === undefined ? undefined : text(error);
}

function constraintOf(label: string): string | undefined {
  const constraint = field(label).findConstraint()?.getElement();
  return constraint === undefined ? undefined : text(constraint);
}

/** The failure shown inside the form (the page's other alert is the area's local-emulator notice). */
function formAlert() {
  const form = document.querySelector('form');
  return form === null ? null : createWrapper(form).findAlert();
}

function createButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Create table' });
}

function cancelButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Cancel' });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

async function opened() {
  const result = open();
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create table' })).toBeInTheDocument();
  });
  return result;
}

function fillValid() {
  type('Table name', 'orders');
  type('Partition key', 'customer');
}

const NAME_RULE = '3 to 255 characters: letters (A-Z, a-z), digits, underscores (_), periods (.) and hyphens (-).';
const UNITS_RULE = 'A whole number of 1 or more.';

// ---------------------------------------------------------------------------------------------------------------

describe('the form as it opens', () => {
  it('the constraint texts under "Table name", "Partition key", "Sort key - optional" and the capacity units', async () => {
    await opened();

    expect(constraintOf('Table name')).toBe(NAME_RULE);
    expect(constraintOf('Partition key')).toBe('1 to 255 characters.');
    expect(constraintOf('Sort key')).toBe('Up to 255 characters.');
    expect(text(field('Sort key').findLabel()?.getElement() as HTMLElement)).toBe('Sort key - optional');

    chooseMode('provisioned');

    expect(constraintOf('Read capacity units')).toBe(UNITS_RULE);
    expect(constraintOf('Write capacity units')).toBe(UNITS_RULE);
    expect(input('Read capacity units').value).toBe('5');
    expect(input('Write capacity units').value).toBe('5');
  });

  it('the keys’ types start as String, the mode as On-demand; the crumbs; the notice names "tables"', async () => {
    await opened();

    expect(text(field('Partition key').findSecondaryControl()?.getElement() as HTMLElement)).toContain('String');
    expect(text(field('Sort key').findSecondaryControl()?.getElement() as HTMLElement)).toContain('String');
    expect(
      field('Capacity mode').findControl()?.findRadioGroup()?.findInputByValue('on-demand')?.getElement(),
    ).toBeChecked();
    expect(PAGE.findAllFormFields().map((each) => text(each.findLabel()?.getElement() ?? document.body))).not.toContain(
      'Read capacity units',
    );
    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => text(crumb.getElement()));
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables', 'Create table']);
    expect(screen.getByText('These tables are in your local emulator')).toBeInTheDocument();
    expect(engine.sent).toEqual([]);
  });
});

describe('the checks at "Create table"', () => {
  it.each([
    ['', 'Enter a table name.'],
    ['ab', 'The name must have 3 to 255 characters.'],
    ['a'.repeat(256), 'The name must have 3 to 255 characters.'],
    ['my table', 'Use only letters, digits, underscore (_), period (.) and hyphen (-).'],
    ['a/b', 'Use only letters, digits, underscore (_), period (.) and hyphen (-).'],
    ['tablé', 'Use only letters, digits, underscore (_), period (.) and hyphen (-).'],
  ])('table name %j → %s, focus on it, nothing sent', async (name, message) => {
    await opened();
    type('Table name', name);
    type('Partition key', 'pk');

    fireEvent.click(createButton());

    expect(messageOf('Table name')).toBe(message);
    expect(constraintOf('Table name')).toBe(NAME_RULE);
    expect(document.activeElement).toBe(input('Table name'));
    expect(engine.sent).toEqual([]);
  });

  it.each([
    ['Partition key', '', 'Enter a partition key.'],
    ['Partition key', 'k'.repeat(256), 'A key name can have up to 255 characters.'],
    ['Sort key', 'k'.repeat(256), 'A key name can have up to 255 characters.'],
    ['Sort key', 'customer', 'The sort key must differ from the partition key.'],
  ])('%s %j → %s, focus on it, nothing sent', async (label, value, message) => {
    await opened();
    type('Table name', 'orders');
    type('Partition key', 'customer');
    type(label, value);

    fireEvent.click(createButton());

    expect(messageOf(label)).toBe(message);
    expect(document.activeElement).toBe(input(label));
    expect(engine.sent).toEqual([]);
  });

  it.each([
    ['Read capacity units', '0'],
    ['Read capacity units', '-1'],
    ['Read capacity units', '1.5'],
    ['Read capacity units', ''],
    ['Write capacity units', 'ten'],
  ])('provisioned, %s %j → "Enter a whole number of 1 or more.", focus on it, nothing sent', async (label, value) => {
    await opened();
    fillValid();
    chooseMode('provisioned');
    type(label, value);

    fireEvent.click(createButton());

    expect(messageOf(label)).toBe('Enter a whole number of 1 or more.');
    expect(document.activeElement).toBe(input(label));
    expect(engine.sent).toEqual([]);
  });

  it('several fields fail: each shows its message, focus on the first', async () => {
    await opened();
    type('Sort key', 'k'.repeat(256));

    fireEvent.click(createButton());

    expect(messageOf('Table name')).toBe('Enter a table name.');
    expect(messageOf('Partition key')).toBe('Enter a partition key.');
    expect(messageOf('Sort key')).toBe('A key name can have up to 255 characters.');
    expect(document.activeElement).toBe(input('Table name'));
    expect(engine.sent).toEqual([]);
  });

  it('a name of 3 and one of 255 characters of the alphabet pass', async () => {
    await opened();
    type('Partition key', 'pk');
    for (const name of ['a-.', `A_9${'z'.repeat(252)}`]) {
      type('Table name', name);
      fireEvent.click(createButton());
      expect(messageOf('Table name')).toBeUndefined();
    }
  });
});

describe('sending', () => {
  it('on-demand, no sort key: one CreateTable of the partition key and PAY_PER_REQUEST', async () => {
    await opened();
    fillValid();

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(engine.of('CreateTable')).toHaveLength(1);
    });
    expect(engine.of('CreateTable')[0]?.body).toEqual({
      TableName: 'orders',
      KeySchema: [{ AttributeName: 'customer', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'customer', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('provisioned with a sort key and other types: both keys, their types and the units', async () => {
    await opened();
    fillValid();
    chooseKeyType('Partition key', 'B');
    type('Sort key', 'placed');
    chooseKeyType('Sort key', 'N');
    chooseMode('provisioned');
    type('Read capacity units', '5');
    type('Write capacity units', '7');

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(engine.of('CreateTable')).toHaveLength(1);
    });
    expect(engine.of('CreateTable')[0]?.body).toEqual({
      TableName: 'orders',
      KeySchema: [
        { AttributeName: 'customer', KeyType: 'HASH' },
        { AttributeName: 'placed', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'customer', AttributeType: 'B' },
        { AttributeName: 'placed', AttributeType: 'N' },
      ],
      BillingMode: 'PROVISIONED',
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 7 },
    });
  });

  it('in flight: the button disabled, focus kept on it, and a second press sends nothing', async () => {
    let release: (answer: Answer) => void = () => undefined;
    engine.createAnswer = () => new Promise<Answer>((resolve) => (release = resolve));
    const { router } = await opened();
    fillValid();
    const button = createButton();
    act(() => {
      button.focus();
    });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(isDisabled(createButton())).toBe(true);
    });
    fireEvent.click(createButton());
    expect(document.activeElement).toBe(createButton());
    expect(engine.of('CreateTable')).toHaveLength(1);

    act(() => {
      release({ status: 200, body: { TableDescription: {} } });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables/table/orders');
    });
    expect(engine.of('CreateTable')).toHaveLength(1);
  });

  it('success: the table’s page opens with "Table {name} is being created." handed to it', async () => {
    const handOver = vi.fn<PageFlash['handOver']>();
    const show = vi.fn<PageFlash['show']>();
    const router = createMemoryRouter(
      [
        {
          path: '/aws/dynamodb/tables/create',
          element: (
            <PageFlashContext.Provider value={{ show, handOver }}>
              <CreateTablePage connection={connection} params={{}} />
            </PageFlashContext.Provider>
          ),
        },
      ],
      { initialEntries: [CREATE_PATH] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    fillValid();

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(handOver).toHaveBeenCalledTimes(1);
    });
    const [to, result] = handOver.mock.calls[0] ?? [];
    expect(to).toBe('/aws/dynamodb/tables/table/orders');
    expect(result?.map((item) => [item.type, item.content])).toEqual([['success', 'Table orders is being created.']]);
    expect(show).not.toHaveBeenCalled();
  });

  it('refusal: the form kept with its values, the failure with its code and message above the buttons', async () => {
    engine.createAnswer = () => refused(400, 'ResourceInUseException', 'Table already exists: orders');
    const { router } = await opened();
    fillValid();
    type('Sort key', 'placed');

    fireEvent.click(createButton());

    const alert = await waitFor(() => {
      const found = formAlert();
      expect(found).not.toBeNull();
      return (found as NonNullable<typeof found>).getElement();
    });
    expect(text(alert)).toContain('Creating the table failed');
    expect(text(alert)).toContain('ResourceInUseException: Table already exists: orders');
    expect(alert.compareDocumentPosition(createButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(input('Table name').value).toBe('orders');
    expect(input('Partition key').value).toBe('customer');
    expect(input('Sort key').value).toBe('placed');
    expect(isDisabled(createButton())).toBe(false);
  });

  it('a refusal of 501 or AccessDenied: their own words', async () => {
    engine.createAnswer = () => ({ status: 501, body: { __type: 'NotImplemented', message: 'no' } });
    await opened();
    fillValid();

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(text(formAlert()?.getElement() ?? document.createElement('i'))).toContain(
        'The emulator answered 501 Not Implemented for CreateTable.',
      );
    });

    engine.createAnswer = () => refused(403, 'AccessDeniedException', 'no policy allows it');
    fireEvent.click(createButton());

    await waitFor(() => {
      expect(text(formAlert()?.getElement() ?? document.createElement('i'))).toContain(
        'CreateTable was refused: no policy allows it',
      );
    });
  });
});

describe('"Cancel"', () => {
  it('nothing changed: leaves for the table list at once', async () => {
    const { router } = await opened();

    fireEvent.click(cancelButton());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables');
    });
    expect(PAGE.findModal()).toBeNull();
  });

  it('a value typed and removed again: leaves at once', async () => {
    const { router } = await opened();
    type('Table name', 'x');
    type('Table name', '');

    fireEvent.click(cancelButton());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables');
    });
  });

  it.each([
    ['a name', () => type('Table name', 'orders')],
    ['a key type', () => chooseKeyType('Sort key', 'N')],
    ['the capacity mode', () => chooseMode('provisioned')],
  ])('with %s changed: the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async (_, changeIt) => {
    const { router } = await opened();
    changeIt();

    fireEvent.click(cancelButton());

    await waitFor(() => {
      expect(text(PAGE.findModal()?.findHeader().getElement() ?? document.body)).toBe('Discard what you entered?');
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    fireEvent.click(
      within(PAGE.findModal()?.getElement() as HTMLElement).getByRole('button', { name: 'Keep editing' }),
    );
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);

    fireEvent.click(cancelButton());
    await waitFor(() => {
      expect(PAGE.findModal()).not.toBeNull();
    });
    fireEvent.click(within(PAGE.findModal()?.getElement() as HTMLElement).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables');
    });
    expect(engine.of('CreateTable')).toHaveLength(0);
  });
});
