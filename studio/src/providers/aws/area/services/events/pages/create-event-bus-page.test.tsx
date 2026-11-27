import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
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
  const handOver = vi.fn<PageFlash['handOver']>();
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
  const { container } = render(
    <MemoryRouter initialEntries={[createPath]}>
      <Area />
    </MemoryRouter>,
  );
  return { page: createWrapper(container), handOver, resources };
}

type Page = ReturnType<typeof renderPage>['page'];

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a Cloudscape wrapper');
  return value;
}

function settings(page: Page) {
  return required(page.findForm()?.findContent()?.findContainer()?.findContent()).findAllFormFields();
}

function busName(page: Page) {
  return required(settings(page)[0]?.findControl()?.findInput()).findNativeInput().getElement();
}

function description(page: Page) {
  return required(settings(page)[1]?.findControl()?.findTextarea()).findNativeTextarea().getElement();
}

function tagEditor(page: Page) {
  return required(page.findForm()?.findContent()?.findAttributeEditor());
}

function tagInput(page: Page, column: number) {
  return required(tagEditor(page).findRow(1)?.findField(column)?.findControl()?.findInput())
    .findNativeInput()
    .getElement();
}

function actions(page: Page) {
  const [cancel, create] = page.findForm()?.findActions()?.findAllButtons() ?? [];
  return { cancel: required(cancel), create: required(create) };
}

function fill(page: Page) {
  fireEvent.change(busName(page), { target: { value: 'Orders' } });
  fireEvent.change(description(page), { target: { value: 'Routes orders' } });
  tagEditor(page).findAddButton().click();
  fireEvent.change(tagInput(page, 1), { target: { value: 'team' } });
  fireEvent.change(tagInput(page, 2), { target: { value: 'core' } });
}

it('shows the name’s rules and optional fields at open with no tag row', () => {
  const { page, resources } = renderPage();
  expect(description(page)).toHaveAccessibleName('Description - optional');
  const tags = page.findForm()?.findContent()?.findAllContainers()[1];
  expect(tags?.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Tags - optional');
  expect(resources).toHaveBeenCalledWith({ word: 'event buses' });
  expect(busName(page)).toHaveAccessibleDescription(
    '1 to 256 characters. Use letters, digits and . - _. The name cannot start with aws.',
  );
  expect(tagEditor(page).findRows()).toHaveLength(0);
});

it('creates the bus once and hands over its success to the bus page', async () => {
  create.mockResolvedValueOnce(undefined);
  const { page, handOver } = renderPage();
  fill(page);
  const action = actions(page).create.getElement();
  fireEvent.click(action);
  fireEvent.click(action);
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
  const [path, items] = handOver.mock.calls[0] ?? [];
  expect(path).toBe('/aws/events/event-buses/bus/Orders');
  expect(items?.[0].type).toBe('success');
  const { container } = render(<>{items?.[0].content}</>);
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
  const { page, handOver } = renderPage();
  fill(page);
  actions(page).create.click();
  const alert = await waitFor(() => required(page.findForm()?.findContent()?.findAlert()));
  expect(alert.getElement()).toHaveTextContent(reason);
  expect(alert.getElement()).toHaveTextContent(operation);
  expect(busName(page)).toHaveValue('Orders');
  expect(description(page)).toHaveValue('Routes orders');
  expect(tagInput(page, 1)).toHaveValue('team');
  expect(tagInput(page, 2)).toHaveValue('core');
  expect(screen.getByTestId('path')).toHaveTextContent(createPath);
  expect(handOver).not.toHaveBeenCalled();
  const action = actions(page).create.getElement();
  if (failure.kind === 'not-implemented') expect(action).toBeDisabled();
  else expect(action).toBeEnabled();
});

it('focuses the first invalid field and sends nothing', () => {
  const { page } = renderPage();
  fireEvent.change(busName(page), { target: { value: 'Orders west' } });
  tagEditor(page).findAddButton().click();
  fireEvent.change(tagInput(page, 1), { target: { value: 'aws:team' } });
  actions(page).create.click();
  expect(settings(page)[0]?.findError()?.getElement()).toHaveTextContent('Use only letters, digits and . - _.');
  expect(busName(page)).toHaveFocus();
  fireEvent.change(busName(page), { target: { value: 'Orders' } });
  actions(page).create.click();
  expect(tagEditor(page).findRow(1)?.findField(1)?.findError()?.getElement()).toHaveTextContent(
    'A tag key cannot start with aws:.',
  );
  expect(tagInput(page, 1)).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
});

it('leaves at once when Cancel is pressed on an unchanged form', () => {
  const { page } = renderPage();
  actions(page).cancel.click();
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/aws\/events\/event-buses$/);
  expect(page.findModal()).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('keeps changes or leaves when the discard dialog is answered', async () => {
  const { page } = renderPage();
  fireEvent.change(description(page), { target: { value: 'Routes orders' } });
  actions(page).cancel.click();
  let dialog = await waitFor(() => required(page.findModal()));
  expect(dialog.findHeader().getElement()).toHaveTextContent('Discard what you entered?');
  const keep = required(dialog.findFooter()?.findAllButtons()[0]);
  expect(keep.getElement()).toHaveAccessibleName('Keep editing');
  keep.click();
  expect(description(page)).toHaveValue('Routes orders');
  actions(page).cancel.click();
  dialog = await waitFor(() => required(page.findModal()));
  const discard = required(dialog.findFooter()?.findAllButtons()[1]);
  expect(discard.getElement()).toHaveAccessibleName('Discard');
  discard.click();
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/aws\/events\/event-buses$/);
  expect(create).not.toHaveBeenCalled();
});
