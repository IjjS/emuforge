import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { apisPath, createApiPath, restApiPath, v2ApiPath } from '../format';
import { SCREENS } from '../screens/create-api';

const endpoint = 'http://127.0.0.1:9684';
const handOver = vi.fn<PageFlash['handOver']>();
const sent = vi.fn<(path: string) => void>();
const answers = new Map<string, () => Response | Promise<Response>>();

beforeEach(() => {
  sent.mockClear();
  handOver.mockClear();
  answers.clear();
  vi.stubGlobal('fetch', (input: Request | string) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    if (pathname === '/__emuforge/session') return Promise.resolve(Response.json({ token: 'test-session' }));
    sent(pathname);
    return Promise.resolve(answers.get(pathname)?.() ?? Response.json({}));
  });
});

afterEach(() => vi.unstubAllGlobals());

function FormArea() {
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const Page = SCREENS.find((entry) => entry.paths.includes(pathname))?.Page;
  return (
    <div ref={root}>
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ handOver, show: vi.fn() }}>
          {Page ? <Page connection={{ engineOrigin: endpoint }} params={{}} /> : <p>{pathname}</p>}
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    </div>
  );
}

function openForm() {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[createApiPath]}>
        <FormArea />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return createWrapper(container);
}

type FormWrapper = ReturnType<typeof openForm>;

function chooseKind(form: FormWrapper, kind: 'REST' | 'HTTP') {
  const option = form.findTiles()?.findInputByValue(kind);
  expect(option).toBeTruthy();
  act(() => option?.click());
}

function enterName(form: FormWrapper, name: string) {
  const input = form.findInput();
  expect(input).toBeTruthy();
  act(() => input?.setInputValue(name));
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create API' }));
}

function flashedText() {
  const result = handOver.mock.calls[0]?.[1] ?? [];
  return render(
    <>
      {result.map((item) => (
        <div key={item.type}>{item.content}</div>
      ))}
    </>,
  );
}

it('asks for the kind first, shows described choices and omits the stage when No stage is chosen', async () => {
  answers.set('/v2/apis', () => Response.json({ apiId: 'http-id', name: 'Local' }));
  const form = openForm();
  expect(form.findInput()).toBeNull();
  expect(form.findRadioGroup()).toBeNull();
  expect(screen.getByText(/Resources and methods, with a Lambda function/)).toBeVisible();
  expect(screen.getByText(/Routes with a Lambda function or an HTTP endpoint/)).toBeVisible();

  chooseKind(form, 'REST');
  expect(screen.getByText('1 to 512 characters.')).toBeVisible();
  expect(screen.getByText("The API's own default when none is given.")).toBeVisible();
  expect(screen.getByText('Meant for callers in the same Region.')).toBeVisible();
  expect(screen.getByText('Meant to be reached from inside a VPC.')).toBeVisible();

  chooseKind(form, 'HTTP');
  expect(screen.getByText('1 to 128 characters.')).toBeVisible();
  expect(screen.getByText('$default stage')).toBeVisible();
  expect(screen.getByText('Create the $default stage')).toBeVisible();
  expect(screen.getByText(/with auto-deploy on/)).toBeVisible();
  expect(screen.getByText('No stage')).toBeVisible();
  expect(screen.getByText(/No stage is created/)).toBeVisible();
  const stageChoice = form.findRadioGroup();
  expect(stageChoice?.findInputByValue('create')?.getElement()).toBeChecked();
  act(() => stageChoice?.findInputByValue('skip')?.click());
  expect(stageChoice?.findInputByValue('skip')?.getElement()).toBeChecked();

  enterName(form, 'Local');
  submit();
  await waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
  expect(sent.mock.calls).toEqual([['/v2/apis']]);
});

it.each([
  ['REST', '/restapis', { id: 'rest-id', name: 'Local' }, restApiPath('rest-id')],
  ['HTTP', '/v2/apis', { apiId: 'http-id', name: 'Local' }, v2ApiPath('http-id')],
] as const)('hands a created %s API and its result to its detail page', async (kind, command, body, path) => {
  answers.set(command, () => Response.json(body));
  const form = openForm();
  chooseKind(form, kind);
  enterName(form, 'Local');
  submit();
  await waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
  expect(handOver.mock.calls[0]?.[0]).toBe(path);
  expect(flashedText().container).toHaveTextContent('API Local created.');
});

it('hands over the created HTTP API with the reason its stage was refused', async () => {
  answers.set('/v2/apis', () => Response.json({ apiId: 'http-id', name: 'Local' }));
  answers.set('/v2/apis/http-id/stages', () => Response.json({ message: 'Stage refused' }, { status: 400 }));
  const form = openForm();
  chooseKind(form, 'HTTP');
  enterName(form, 'Local');
  submit();
  await waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
  expect(handOver.mock.calls[0]?.[0]).toBe(v2ApiPath('http-id'));
  expect(handOver.mock.calls[0]?.[1].map(({ type }) => type)).toEqual(['success', 'warning']);
  expect(flashedText().container).toHaveTextContent('API Local created.');
  expect(flashedText().container).toHaveTextContent('API Local created, but stage $default was not: Stage refused');
});

describeCreateFailures('REST', '/restapis', 'CreateRestApi');
describeCreateFailures('HTTP', '/v2/apis', 'CreateApi');

function describeCreateFailures(kind: 'REST' | 'HTTP', command: string, operation: string) {
  it.each([
    {
      status: 501,
      code: 'NotImplementedException',
      message: 'Unimplemented',
      title: 'Not implemented by the emulator',
    },
    { status: 403, code: 'AccessDeniedException', message: 'Denied by the engine', title: 'Access denied' },
    {
      status: 503,
      code: 'EmulatorUnavailable',
      message: 'The emulator is offline',
      title: 'The emulator did not answer',
    },
    { status: 400, code: 'BadRequestException', message: 'A different refusal', title: `${operation} failed` },
  ])('keeps the %s request refusal on the form', async ({ status, code, message, title }) => {
    answers.set(command, () => Response.json({ message }, { status, headers: { 'x-amzn-errortype': code } }));
    const form = openForm();
    chooseKind(form, kind);
    enterName(form, 'Local');
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(operation);
    if (status !== 501) expect(alert).toHaveTextContent(message);
    expect(form.findInput()?.getInputValue()).toBe('Local');
    expect(screen.getByRole('button', { name: 'Create API' }).hasAttribute('disabled')).toBe(status === 501);
    expect(handOver).not.toHaveBeenCalled();
  });

  it(`shows when the engine cannot answer ${operation}`, async () => {
    answers.set(command, () => Promise.reject(new TypeError('failed to fetch')));
    const form = openForm();
    chooseKind(form, kind);
    enterName(form, 'Local');
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`The EmuForge engine at ${endpoint} did not answer`);
    expect(alert).toHaveTextContent(operation);
    expect(form.findInput()?.getInputValue()).toBe('Local');
    expect(handOver).not.toHaveBeenCalled();
  });
}

it('leaves for APIs when Cancel is pressed on the unchanged form', () => {
  openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText(apisPath)).toBeVisible();
});

it('confirms Cancel on a changed form and keeps entries until Discard', async () => {
  const form = openForm();
  chooseKind(form, 'REST');
  enterName(form, 'Local');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('dialog', { name: 'Discard what you entered?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(form.findInput()?.getInputValue()).toBe('Local');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByText(apisPath)).toBeVisible();
  expect(sent).not.toHaveBeenCalled();
});

it('disables Create API while the request is sending', async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  answers.set('/restapis', () => pending);
  const form = openForm();
  chooseKind(form, 'REST');
  enterName(form, 'Local');
  submit();
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  const button = screen.getByRole('button', { name: 'Create API' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(button);
  resolve(Response.json({ id: 'rest-id', name: 'Local' }));
  await waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
  expect(sent).toHaveBeenCalledTimes(1);
});
