import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { CREATE_LOG_GROUP_PATH, LOG_GROUPS_PATH } from '../format';
import { createLogGroup, putRetentionPolicy } from '../group-create-api';
import { CreateLogGroupPage } from './create-log-group-page';

vi.mock('../group-create-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../group-create-api')>()),
  createLogGroup: vi.fn(),
  putRetentionPolicy: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8309';
const NAME = '/app#new';
const GROUP_PATH = '/aws/logs/log-groups/group/%2Fapp%23new';
const DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653];
const create = vi.mocked(createLogGroup);
const put = vi.mocked(putRetentionPolicy);
const show = vi.fn<PageFlash['show']>();
const handOver = vi.fn<PageFlash['handOver']>();
const resources = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue({ $metadata: {} });
  put.mockResolvedValue({ $metadata: {} });
});

function FormInArea() {
  const root = useRef<HTMLDivElement>(null);
  return (
    <AreaRootContext.Provider value={root}>
      <PageResourcesContext.Provider value={resources}>
        <PageFlashContext.Provider value={{ show, handOver }}>
          <div ref={root}>
            <CreateLogGroupPage connection={{ engineOrigin: ENGINE, result: undefined }} params={{}} />
          </div>
        </PageFlashContext.Provider>
      </PageResourcesContext.Provider>
    </AreaRootContext.Provider>
  );
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[CREATE_LOG_GROUP_PATH]}>
        <Routes>
          <Route path={CREATE_LOG_GROUP_PATH} element={<FormInArea />} />
          <Route path={LOG_GROUPS_PATH} element={<h1>Log groups</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const page = createWrapper(document.body);

function required<T>(control: T | null | undefined, label: string): T {
  if (control === null || control === undefined) throw new Error(`Control "${label}" was not found.`);
  return control;
}

function field(label: string) {
  const found = page.findAllFormFields().find((item) => item.findLabel()?.getElement().textContent === label);
  if (found === undefined) throw new Error(`Field "${label}" was not found.`);
  return found;
}

function nativeInput(control: Element) {
  return required(createWrapper(control).findInput(), 'Input').findNativeInput().getElement();
}

const nameInput = () => nativeInput(field('Log group name').getElement());
const select = (label: string) => required(createWrapper(field(label).getElement()).findSelect(), label);
const submitButton = () => screen.getByRole('button', { name: 'Create log group' });

function nameGroup(name: string) {
  fireEvent.change(nameInput(), { target: { value: name } });
}

function choose(label: string, value: string) {
  const control = select(label);
  act(() => control.openDropdown());
  act(() => control.selectOptionByValue(value));
}

function addTag(key: string, value: string) {
  const editor = required(page.findAttributeEditor(), 'Tags');
  act(() => required(editor.findAddButton(), 'Add tag').click());
  const [keyInput, valueInput] = required(editor.findRows().at(-1), 'Last tag row').findFields();
  fireEvent.change(nativeInput(required(keyInput, 'Tag key').getElement()), { target: { value: key } });
  fireEvent.change(nativeInput(required(valueInput, 'Tag value').getElement()), { target: { value } });
}

function fill() {
  nameGroup(NAME);
  choose('Log class', 'INFREQUENT_ACCESS');
  choose('Retention', '7');
  act(() => required(page.findCheckbox(), 'Deletion protection').findNativeInput().click());
  addTag('team', 'core');
}

function expectFormKept() {
  expect(nameInput()).toHaveValue(NAME);
  expect(select('Log class').findTrigger().getElement()).toHaveTextContent('Infrequent Access');
  expect(select('Retention').findTrigger().getElement()).toHaveTextContent('7 days');
  expect(required(page.findCheckbox(), 'Deletion protection').findNativeInput().getElement()).toBeChecked();
  const [key, value] = required(
    required(page.findAttributeEditor(), 'Tags').findRows()[0],
    'First tag row',
  ).findFields();
  expect(nativeInput(required(key, 'Tag key').getElement())).toHaveValue('team');
  expect(nativeInput(required(value, 'Tag value').getElement())).toHaveValue('core');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const submit = () => fireEvent.click(submitButton());
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
const expectSuccess = () =>
  expect(handOver).toHaveBeenCalledWith(GROUP_PATH, [{ type: 'success', content: `Log group ${NAME} created.` }]);

function refusal(operation: 'CreateLogGroup' | 'PutRetentionPolicy', message: string) {
  return new RequestError({ kind: 'other', code: 'InvalidParameterException', operation, message });
}

it('opens with the name constraint, the three described classes, Never expire and protection off', () => {
  open();
  expect(resources).toHaveBeenCalledWith({ word: 'log groups' });
  expect(field('Log group name').findConstraint()?.getElement()).toHaveTextContent(
    '1 to 512 characters. Use letters, digits and . - _ / #. The name cannot start with aws/.',
  );
  const logClass = select('Log class');
  expect(logClass.findTrigger().getElement()).toHaveTextContent('Standard');
  expect(select('Retention').findTrigger().getElement()).toHaveTextContent('Never expire');
  expect(required(page.findCheckbox(), 'Deletion protection').findNativeInput().getElement()).not.toBeChecked();
  act(() => logClass.openDropdown());
  const classes = logClass.findDropdown();
  expect(classes.findOptions()).toHaveLength(3);
  for (const [value, label, description] of [
    ['STANDARD', 'Standard', 'Log events can be put, read and searched.'],
    [
      'INFREQUENT_ACCESS',
      'Infrequent Access',
      'Log events can be put. The emulator refuses to read or search them in this class.',
    ],
    ['DELIVERY', 'Delivery', 'Log events can be put. The emulator refuses to read or search them in this class.'],
  ] as const) {
    const option = classes.findOptionByValue(value);
    expect(option?.findLabel().getElement()).toHaveTextContent(label);
    expect(option?.findDescription()?.getElement()).toHaveTextContent(description);
  }
});

it('offers all 23 retention choices in the form with a distinct description each', () => {
  open();
  const retention = select('Retention');
  act(() => retention.openDropdown());
  const dropdown = retention.findDropdown();
  expect(dropdown.findOptions()).toHaveLength(23);
  const descriptions = ['', ...DAYS.map(String)].map(
    (value) => dropdown.findOptionByValue(value)?.findDescription()?.getElement().textContent,
  );
  expect(descriptions.every(Boolean)).toBe(true);
  expect(new Set(descriptions).size).toBe(23);
});

it('creates with Never expire in one call and hands over the success to the new group', async () => {
  open();
  nameGroup(NAME);
  submit();
  await waitFor(expectSuccess);
  expect(create).toHaveBeenCalledExactlyOnceWith(
    ENGINE,
    { logGroupName: NAME, logGroupClass: 'STANDARD' },
    expect.any(AbortSignal),
  );
  expect(put).not.toHaveBeenCalled();
});

it('waits for creation, then puts seven days before handing over the result', async () => {
  const creation = deferred<Awaited<ReturnType<typeof createLogGroup>>>();
  const retention = deferred<Awaited<ReturnType<typeof putRetentionPolicy>>>();
  create.mockReturnValueOnce(creation.promise);
  put.mockReturnValueOnce(retention.promise);

  open();
  fill();
  submit();
  expect(create).toHaveBeenCalledExactlyOnceWith(
    ENGINE,
    {
      logGroupName: NAME,
      logGroupClass: 'INFREQUENT_ACCESS',
      deletionProtectionEnabled: true,
      tags: { team: 'core' },
    },
    expect.any(AbortSignal),
  );
  expect(put).not.toHaveBeenCalled();
  expect(handOver).not.toHaveBeenCalled();

  await act(() => creation.resolve({ $metadata: {} }));
  expect(put).toHaveBeenCalledExactlyOnceWith(ENGINE, NAME, 7, expect.any(AbortSignal));
  expect(handOver).not.toHaveBeenCalled();

  await act(() => retention.resolve({ $metadata: {} }));
  expectSuccess();
});

it('reports a refused create with its operation and leaves all fields as entered', async () => {
  create.mockRejectedValueOnce(refusal('CreateLogGroup', 'A group by that name already exists.'));
  open();
  fill();
  submit();
  await waitFor(() =>
    expect(show).toHaveBeenCalledWith([expect.objectContaining({ type: 'error', header: 'CreateLogGroup failed' })]),
  );
  const item = show.mock.lastCall?.[0][0];
  const { getByText } = render(<>{item?.content}</>);
  expect(getByText(/A group by that name already exists\./)).toBeVisible();
  expectFormKept();
  expect(put).not.toHaveBeenCalled();
  expect(handOver).not.toHaveBeenCalled();
});

it('hands over the partial result and the retention refusal after creating the group', async () => {
  put.mockRejectedValueOnce(refusal('PutRetentionPolicy', 'Retention could not be stored.'));
  open();
  fill();
  submit();
  await waitFor(() =>
    expect(handOver).toHaveBeenCalledWith(GROUP_PATH, [
      { type: 'warning', content: `Log group ${NAME} created, but its retention was not set.` },
      expect.objectContaining({ type: 'error', header: 'PutRetentionPolicy failed' }),
    ]),
  );
  const item = handOver.mock.lastCall?.[1][1];
  const { getByText } = render(<>{item?.content}</>);
  expect(getByText(/Retention could not be stored\./)).toBeVisible();
});

it('keeps the filled form and disables the action if CreateLogGroup answers 501', async () => {
  create.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'CreateLogGroup' }));
  open();
  fill();
  submit();
  await waitFor(() =>
    expect(show).toHaveBeenCalledWith([
      {
        type: 'info',
        header: 'Not implemented by the emulator',
        content: 'The emulator answered 501 Not Implemented for CreateLogGroup.',
      },
    ]),
  );
  expect(submitButton()).toBeDisabled();
  expectFormKept();
  expect(put).not.toHaveBeenCalled();
  expect(handOver).not.toHaveBeenCalled();
});

it('hands over the partial result with the operation when retention answers 501', async () => {
  put.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'PutRetentionPolicy' }));
  open();
  fill();
  submit();
  await waitFor(() =>
    expect(handOver).toHaveBeenCalledWith(GROUP_PATH, [
      { type: 'warning', content: `Log group ${NAME} created, but its retention was not set.` },
      {
        type: 'info',
        header: 'Not implemented by the emulator',
        content: 'The emulator answered 501 Not Implemented for PutRetentionPolicy.',
      },
    ]),
  );
});

it('reports an invalid name and an invalid tag on their fields without sending a request', () => {
  open();
  nameGroup('aws/forbidden');
  submit();
  expect(field('Log group name').findError()?.getElement()).toHaveTextContent('The name cannot start with aws/.');
  expect(create).not.toHaveBeenCalled();

  nameGroup(NAME);
  addTag('aws:team', 'core');
  submit();
  expect(screen.getByText('A tag key cannot start with aws:.')).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it('cancels an untouched form immediately', () => {
  open();
  cancel();
  expect(screen.getByRole('heading', { name: 'Log groups' })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('offers to discard edits, keeps them on request and discards without sending anything', async () => {
  open();
  fill();
  cancel();
  const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expectFormKept();

  cancel();
  const reopened = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
  fireEvent.click(within(reopened).getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('heading', { name: 'Log groups' })).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
