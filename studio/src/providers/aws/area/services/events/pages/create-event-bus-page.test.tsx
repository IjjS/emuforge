import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { createEventBus } from '../bus-change-api';
import { CreateEventBusPage } from './create-event-bus-page';

vi.mock('../bus-change-api', async (original) => ({
  ...(await original<typeof import('../bus-change-api')>()),
  createEventBus: vi.fn(),
}));

const create = vi.mocked(createEventBus);
const endpoint = 'http://127.0.0.1:8315';
const createPath = '/aws/events/event-buses/create';
const operation = 'CreateEventBus';

beforeEach(() => create.mockReset());

function renderPage() {
  const resources = vi.fn();
  const handOver = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const { pathname } = useLocation();
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <div data-testid="path">{pathname}</div>
          <PageResourcesContext.Provider value={resources}>
            <PageFlashContext.Provider value={{ show: vi.fn(), handOver }}>
              {pathname === createPath && (
                <CreateEventBusPage connection={{ engineOrigin: endpoint, result: undefined }} params={{}} />
              )}
            </PageFlashContext.Provider>
          </PageResourcesContext.Provider>
        </div>
      </AreaRootContext.Provider>
    );
  }
  render(
    <MemoryRouter initialEntries={[createPath]}>
      <Area />
    </MemoryRouter>,
  );
  return { handOver, resources };
}

function field(name: string) {
  return screen.getByRole('textbox', { name });
}

function enter(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function fill() {
  enter('Event bus name', 'Orders');
  enter('Description', 'Routes orders');
  click('Add tag');
  enter('Key', 'team');
  enter('Value', 'core');
}

it('shows the name’s rules at open with no tag row', () => {
  const { resources } = renderPage();
  expect(resources).toHaveBeenCalledWith({ word: 'event buses' });
  expect(field('Event bus name')).toHaveAccessibleDescription(
    '1 to 256 characters. Use letters, digits and . - _. The name cannot start with aws.',
  );
  expect(screen.queryByRole('textbox', { name: 'Key' })).toBeNull();
});

it('creates the bus once and hands over its success to the bus page', async () => {
  create.mockResolvedValueOnce(undefined);
  const { handOver } = renderPage();
  fill();
  click('Create event bus');
  click('Create event bus');
  await waitFor(() => expect(handOver).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledExactlyOnceWith(
    endpoint,
    {
      Name: 'Orders',
      Description: 'Routes orders',
      Tags: [{ Key: 'team', Value: 'core' }],
    },
    expect.any(AbortSignal),
  );
  const [path, items] = handOver.mock.calls[0] as [string, { type: string; content: React.ReactNode }[]];
  expect(path).toBe('/aws/events/event-buses/bus/Orders');
  expect(items[0]?.type).toBe('success');
  const { container } = render(<>{items[0]?.content}</>);
  expect(container).toHaveTextContent('Event bus Orders created.');
});

const failures: [RequestFailure, string][] = [
  [
    { kind: 'other', operation, code: 'ResourceAlreadyExistsException', message: 'Orders already exists.' },
    'Orders already exists.',
  ],
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator'],
];

it.each(failures)('keeps the entered form and stays on page after %s', async (failure, reason) => {
  create.mockRejectedValueOnce(new RequestError(failure));
  const { handOver } = renderPage();
  fill();
  click('Create event bus');
  await screen.findByText(reason, { exact: false });
  expect(screen.getByRole('alert')).toHaveTextContent(operation);
  expect(field('Event bus name')).toHaveValue('Orders');
  expect(field('Description')).toHaveValue('Routes orders');
  expect(field('Key')).toHaveValue('team');
  expect(field('Value')).toHaveValue('core');
  expect(screen.getByTestId('path')).toHaveTextContent(createPath);
  expect(handOver).not.toHaveBeenCalled();
  const action = screen.getByRole('button', { name: 'Create event bus' });
  if (failure.kind === 'not-implemented') expect(action).toBeDisabled();
  else expect(action).toBeEnabled();
});

it('focuses the first invalid field and sends nothing', () => {
  renderPage();
  enter('Event bus name', 'Orders west');
  click('Add tag');
  enter('Key', 'aws:team');
  click('Create event bus');
  expect(screen.getByText('Use only letters, digits and . - _.')).toBeVisible();
  expect(field('Event bus name')).toHaveFocus();
  enter('Event bus name', 'Orders');
  click('Create event bus');
  expect(screen.getByText('A tag key cannot start with aws:.')).toBeVisible();
  expect(field('Key')).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});

it('leaves at once when Cancel is pressed on an unchanged form', () => {
  renderPage();
  click('Cancel');
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/aws\/events\/event-buses$/);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('keeps changes or leaves when the discard dialog is answered', async () => {
  renderPage();
  enter('Description', 'Routes orders');
  click('Cancel');
  let dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(field('Description')).toHaveValue('Routes orders');
  click('Cancel');
  dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/aws\/events\/event-buses$/);
  expect(create).not.toHaveBeenCalled();
});
