import { ECSClient, ECSServiceException } from '@aws-sdk/client-ecs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import { ECS_KEYS } from '../queries';
import { serviceKey } from '../service-queries';

vi.mock('../../../lib/ec2-network-choices', async (original) => ({
  ...(await original<typeof network>()),
  listSubnetChoices: vi.fn(),
}));

vi.mock('../../../components/security-group-choices', async (original) => {
  const real = await original<typeof import('../../../components/security-group-choices')>();
  return {
    ...real,
    securityGroupChoices: (endpoint: string | undefined, vpc?: string) => ({
      ...real.securityGroupChoices(endpoint, vpc),
      read: async () => ({ items: [{ id: 'sg-a', name: 'frontend' }] }),
    }),
  };
});

const ENGINE = 'http://127.0.0.1:9759';
const EMULATOR = { port: 9306, endpoint: 'https://127.0.0.1:9306' };
const CLUSTER = '/aws/ecs/clusters/cluster/dev';
const FORM = `${CLUSTER}/services/create`;
const DETAIL = `${CLUSTER}/services/service/returned`;
const ACTIVE = { clusters: [{ clusterName: 'dev', status: 'ACTIVE' }] };
const ARN = 'arn:aws:ecs:us-east-1:000000000000:service/dev/returned';
const DEFINITION = 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:2';
const SERVICE = {
  serviceName: 'returned',
  serviceArn: ARN,
  status: 'ACTIVE',
  desiredCount: 0,
  runningCount: 0,
  pendingCount: 0,
  launchType: 'FARGATE',
  taskDefinition: DEFINITION,
  networkConfiguration: {
    awsvpcConfiguration: { subnets: ['subnet-a'], securityGroups: ['sg-a'], assignPublicIp: 'DISABLED' },
  },
};
const FAMILY = 'Task definition family';
const REVISION = 'Revision';
const SUBNETS = 'Subnets';
const GROUPS = 'Security groups';
const duplicate = 'Creation of service was not idempotent.';

function reply(body: { __type?: string; message?: string } & Record<string, unknown>, status = 200) {
  if (status >= 400) {
    throw new ECSServiceException({
      $metadata: { httpStatusCode: status },
      $fault: 'client',
      name: body.__type ?? 'Unknown',
      ...(body.message === undefined ? {} : { message: body.message }),
    });
  }
  return body;
}

const emulator = vi.fn<(operation: string, body: unknown) => unknown>();
function normal(operation: string) {
  switch (operation) {
    case 'DescribeClusters':
      return reply(ACTIVE);
    case 'ListTaskDefinitionFamilies':
      return reply({ families: ['web'] });
    case 'ListTaskDefinitions':
      return reply({ taskDefinitionArns: [DEFINITION] });
    case 'DescribeTaskDefinition':
      return reply({ taskDefinition: { status: 'ACTIVE', compatibilities: ['FARGATE'], networkMode: 'awsvpc' } });
    case 'ListTasks':
      return reply({ taskArns: [] });
    case 'ListServices':
      return reply({ serviceArns: [ARN] });
    case 'DescribeServices':
      return reply({ services: [SERVICE] });
    case 'CreateService':
      return reply({ service: SERVICE });
    default:
      throw new Error(`Unexpected operation ${operation}`);
  }
}

const calls = (operation: string) => emulator.mock.calls.filter(([op]) => op === operation);
const nameInput = () => screen.getByRole('textbox', { name: 'Service name' });
const countInput = () => screen.getByRole('spinbutton', { name: 'Desired tasks' });
const publicIp = () => screen.getByRole('checkbox', { name: 'Assign public IP' });
const submitButton = () => screen.getByRole('button', { name: 'Create service' });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let connection: AreaConnection;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => connection;

function Area() {
  const current = useSyncExternalStore(subscribe, snapshot);
  const { key } = useLocation();
  const [route, setRoute] = useState({ key, changes: 0 });
  const routeChanges = key === route.key ? route.changes : route.changes + 1;
  if (key !== route.key) {
    setRoute({ key, changes: routeChanges });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={routeChanges}
      connection={current}
    />
  );
}

function open() {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [FORM] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

function connect() {
  connection = { engineOrigin: ENGINE, result: { kind: 'connected', emulator: EMULATOR, checkedAt: 1 } };
  listeners.forEach((listener) => listener());
}

beforeEach(() => {
  vi.clearAllMocks();
  connect();
  emulator.mockImplementation(normal);
  vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [{ id: 'subnet-a', vpcId: 'vpc-dev' }] });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected request in the page test')));
  vi.spyOn(ECSClient.prototype, 'send').mockImplementation((command) => {
    const operation = command.constructor.name.replace(/Command$/, '');
    return Promise.resolve(emulator(operation, command.input));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function labeledField(label: string) {
  const found = createWrapper(document.body)
    .findAllFormFields()
    .find((part) => part.findLabel()?.getElement().textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

function field(label: string) {
  return createWrapper(labeledField(label).getElement());
}

function flashItems() {
  return createWrapper(document.body).findFlashbar()?.findItems() ?? [];
}

function flashWithText(text: string, part: 'header' | 'content' = 'content') {
  return waitFor(() => {
    const found = flashItems().find((item) => {
      const element = part === 'header' ? item.findHeader() : item.findContent();
      return element?.getElement().textContent?.includes(text);
    });
    if (!found) throw new Error(`No flash ${part} contains ${text}`);
    return found;
  });
}

async function choose(label: string, value: string) {
  const input = label === SUBNETS || label === GROUPS ? field(label).findMultiselect() : field(label).findSelect();
  if (!input) throw new Error(`Missing choice field ${label}`);
  if (input.findTrigger().getElement().getAttribute('aria-expanded') !== 'true') input.openDropdown();
  await waitFor(() => expect(input.findDropdown().findOptionByValue(value)).not.toBeNull());
  input.selectOptionByValue(value);
  input.closeDropdown();
}

async function fill() {
  await screen.findByRole('textbox', { name: 'Service name' });
  fireEvent.change(nameInput(), { target: { value: 'entered' } });
  fireEvent.change(countInput(), { target: { value: '0' } });
  await choose(FAMILY, 'web');
  await waitFor(() => expect(field(REVISION).findSelect()?.findTrigger().getElement()).toHaveTextContent('web:2'));
  await choose(SUBNETS, 'subnet-a');
  await choose(GROUPS, 'sg-a');
  fireEvent.click(publicIp());
}

function expectKept() {
  expect(nameInput()).toHaveValue('entered');
  expect(countInput()).toHaveValue(0);
  expect(field(FAMILY).findSelect()?.findTrigger().getElement()).toHaveTextContent('web');
  expect(field(REVISION).findSelect()?.findTrigger().getElement()).toHaveTextContent('web:2');
  expect(screen.getByRole('button', { name: 'Remove subnet-a' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove frontend' })).toBeInTheDocument();
  expect(publicIp()).not.toBeChecked();
}

function expectGated() {
  expect(screen.queryByRole('textbox', { name: 'Service name' })).not.toBeInTheDocument();
  expect(calls('ListTaskDefinitionFamilies')).toHaveLength(0);
  expect(network.listSubnetChoices).not.toHaveBeenCalled();
}

it('holds the form and its choices until the cluster gate finds an active cluster', async () => {
  const held = deferred<unknown>();
  emulator.mockImplementation((op) => (op === 'DescribeClusters' ? held.promise : normal(op)));
  open();
  expect(await screen.findByText('Loading cluster')).toBeInTheDocument();
  expectGated();
  held.resolve(reply(ACTIVE));
  expect(await screen.findByRole('textbox', { name: 'Service name' })).toBeInTheDocument();
});

it.each([
  { clusters: [], failures: [{ reason: 'MISSING' }] },
  { clusters: [{ clusterName: 'dev', status: 'INACTIVE' }] },
])('shows the missing cluster state for %j', async (answer) => {
  emulator.mockImplementation((op) => (op === 'DescribeClusters' ? reply(answer) : normal(op)));
  open();
  expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
  expect(screen.getByText('The local emulator has no active cluster of this name.')).toBeInTheDocument();
  expect(
    screen.getAllByRole('link', { name: 'Clusters' }).some((link) => link.getAttribute('href') === '/aws/ecs/clusters'),
  ).toBe(true);
  expectGated();
});

function gateError(kind: 'emulator' | 'engine') {
  if (kind === 'engine') throw new TypeError('engine fetch failed');
  return reply({ __type: 'EmulatorTimeout', message: 'probe timed out' }, 504);
}

it.each(['emulator', 'engine'] as const)(
  'keeps the %s cluster diagnostic alongside connection recovery and Retry',
  async (kind) => {
    connection = {
      engineOrigin: ENGINE,
      result:
        kind === 'emulator'
          ? { kind: 'emulator-unreachable', reason: 'timeout', message: '', emulator: EMULATOR, checkedAt: 0 }
          : { kind: 'engine-unreachable', lastEmulatorPort: EMULATOR.port, checkedAt: 0 },
    };
    let refused = true;
    emulator.mockImplementation((op) => (op === 'DescribeClusters' && refused ? gateError(kind) : normal(op)));
    open();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const state = retry.parentElement?.parentElement;
    if (!state) throw new Error('Missing cluster read failure state');
    const recovery = within(state).getByRole('link', { name: 'Connection status' });
    expect(recovery).toHaveAttribute('href', '/');
    expect(state).toHaveTextContent(kind === 'emulator' ? 'Not answering at' : 'is not answering');
    expect(state).toHaveTextContent(kind === 'emulator' ? 'probe timed out' : ENGINE);
    expect(retry).toBeEnabled();
    expectGated();
    refused = false;
    act(connect);
    fireEvent.click(retry);
    expect(await screen.findByRole('textbox', { name: 'Service name' })).toBeInTheDocument();
    expect(calls('DescribeClusters')).toHaveLength(2);
  },
);

it('shows the DescribeClusters denial and withholds the form and choices', async () => {
  emulator.mockImplementation((op) =>
    op === 'DescribeClusters'
      ? reply({ __type: 'AccessDeniedException', message: 'only operations may view this cluster' }, 403)
      : normal(op),
  );
  open();
  expect(await screen.findByText('Access denied')).toBeInTheDocument();
  expect(screen.getByText('DescribeClusters was refused: only operations may view this cluster')).toBeInTheDocument();
  expectGated();
});

it('keeps Retry visible and disabled for unsupported DescribeClusters', async () => {
  emulator.mockImplementation((op) => (op === 'DescribeClusters' ? reply({}, 501) : normal(op)));
  open();
  expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
  expect(screen.getByText(/501 Not Implemented for DescribeClusters/)).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: 'Retry' });
  expect(retry).toBeDisabled();
  fireEvent.click(retry);
  expect(calls('DescribeClusters')).toHaveLength(1);
  expectGated();
});

it('identifies the cluster and launch type and presents the seven initial inputs and notice', async () => {
  open();
  expect(await screen.findByRole('textbox', { name: 'Service name' })).toHaveValue('');
  expect(screen.getByText('Cluster dev · Launch type Fargate')).toBeInTheDocument();
  expect(field(FAMILY).findSelect()?.findTrigger().getElement()).toHaveTextContent('Choose a family');
  expect(field(REVISION).findSelect()?.findTrigger().getElement()).toHaveTextContent('Choose a family first');
  expect(countInput()).toHaveValue(1);
  expect(labeledField('Desired tasks').findConstraint()?.getElement()).toHaveTextContent('A whole number, 0 or more.');
  expect(field(SUBNETS).findMultiselect()?.findTokens()).toHaveLength(0);
  expect(field(GROUPS).findMultiselect()?.findTokens()).toHaveLength(0);
  expect(publicIp()).toBeChecked();
  const about = screen.getByRole('button', { name: 'About the local emulator' });
  if (about.getAttribute('aria-expanded') !== 'true') fireEvent.click(about);
  expect(screen.getByText('These services and tasks are in your local emulator')).toBeInTheDocument();
});

it('disables family and create only after a successful empty family read and associates the registration reason', async () => {
  const first = deferred<unknown>();
  let retry = false;
  emulator.mockImplementation((operation) => {
    if (operation !== 'ListTaskDefinitionFamilies') return normal(operation);
    return retry ? reply({ families: [] }) : first.promise;
  });
  open();
  await screen.findByRole('textbox', { name: 'Service name' });
  const family = () => field(FAMILY).findSelect()?.findTrigger().getElement();
  expect(family()).toBeEnabled();
  expect(submitButton()).toBeEnabled();

  first.resolve(Promise.resolve().then(() => reply({ __type: 'ClientException', message: 'family read failed' }, 400)));
  expect(await screen.findByText(/family read failed/)).toBeInTheDocument();
  expect(family()).toBeEnabled();
  expect(submitButton()).toBeEnabled();

  retry = true;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  const register = await screen.findByRole('link', { name: 'Register one first.' });
  expect(register).toBeVisible();
  expect(register).toHaveAttribute('href', '/aws/ecs/task-definitions/register');
  expect(family()).toBeDisabled();
  expect(family()).toHaveAccessibleDescription(/No task definitions\./);
  expect(submitButton()).toBeDisabled();
  expect(submitButton()).toHaveAccessibleDescription(/No task definitions\./);
  fireEvent.click(submitButton());
  expect(calls('CreateService')).toHaveLength(0);
});

it('validates each missing or invalid field and focuses the first without sending a create', async () => {
  open();
  await screen.findByRole('textbox', { name: 'Service name' });
  fireEvent.change(countInput(), { target: { value: '-1' } });
  fireEvent.click(submitButton());
  for (const [label, message] of [
    ['Service name', 'Enter a service name.'],
    [FAMILY, 'Choose a task definition family.'],
    [REVISION, 'Choose a revision.'],
    ['Desired tasks', 'Enter a whole number, 0 or more.'],
    [SUBNETS, 'Choose at least one subnet.'],
  ] as const) {
    expect(labeledField(label).findError()?.getElement()).toHaveTextContent(message);
  }
  expect(labeledField('Desired tasks').findConstraint()?.getElement()).toHaveTextContent('A whole number, 0 or more.');
  expect(nameInput()).toHaveFocus();
  expect(calls('CreateService')).toHaveLength(0);
});

it('focuses the diagnostic when the first invalid choice failed with 501', async () => {
  emulator.mockImplementation((op) => (op === 'ListTaskDefinitionFamilies' ? reply({}, 501) : normal(op)));
  open();
  await screen.findByRole('textbox', { name: 'Service name' });
  const diagnostic = await screen.findByRole('group', { name: `${FAMILY} diagnostic` });
  const trigger = field(FAMILY).findSelect()?.findTrigger().getElement();
  expect(trigger).toBeDisabled();
  fireEvent.change(nameInput(), { target: { value: 'entered' } });

  fireEvent.change(countInput(), { target: { value: '-1' } });
  fireEvent.click(submitButton());

  expect(labeledField(FAMILY).findError()?.getElement().textContent ?? '').not.toContain(
    'Choose a task definition family.',
  );
  expect(labeledField(REVISION).findError()?.getElement().textContent ?? '').not.toContain('Choose a revision.');
  expect(labeledField('Desired tasks').findError()?.getElement()).toHaveTextContent('Enter a whole number, 0 or more.');
  expect(labeledField(SUBNETS).findError()?.getElement()).toHaveTextContent('Choose at least one subnet.');
  expect(diagnostic).toHaveFocus();
  expect(diagnostic).toHaveAccessibleDescription(/501 Not Implemented for ListTaskDefinitionFamilies/);
  expect(nameInput()).toHaveValue('entered');
  expect(calls('CreateService')).toHaveLength(0);
});

it.each(['covered mobile', 'visible mobile', 'desktop'] as const)(
  'keeps family diagnostic focus and corrects only the covered landing (%s)',
  async (landing) => {
    emulator.mockImplementation((op) => (op === 'ListTaskDefinitionFamilies' ? reply({}, 501) : normal(op)));
    open();
    const diagnostic = await screen.findByRole('group', { name: `${FAMILY} diagnostic` });
    const toolbar = screen.getByRole('navigation', { name: 'Breadcrumbs' }).parentElement;
    if (!toolbar) throw new Error('Missing breadcrumb toolbar');
    if (landing !== 'desktop') {
      toolbar.style.position = 'sticky';
      vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 56, 390, 48));
    }
    const filled = landing !== 'visible mobile';
    if (filled) {
      fireEvent.change(nameInput(), { target: { value: 'entered' } });
      fireEvent.change(countInput(), { target: { value: '-1' } });
      await choose(SUBNETS, 'subnet-a');
      await choose(GROUPS, 'sg-a');
      fireEvent.click(publicIp());
    }
    vi.spyOn(diagnostic, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, landing === 'visible mobile' ? 120 : 56, 350, 100),
    );
    const scrollIntoView = vi.fn(() => {
      expect(diagnostic).toHaveFocus();
      expect(labeledField('Desired tasks').findError()?.getElement()).toHaveTextContent(
        'Enter a whole number, 0 or more.',
      );
      expect(diagnostic.style.scrollMarginTop).toBe('calc(48px + var(--space-static-xs-b6kz15))');
    });
    Object.defineProperty(diagnostic, 'scrollIntoView', { value: scrollIntoView });
    submitButton().focus();

    fireEvent.click(submitButton());

    expect(diagnostic).toHaveFocus();
    if (landing === 'covered mobile') {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    } else {
      expect(scrollIntoView).not.toHaveBeenCalled();
    }
    if (filled) {
      expect(nameInput()).toHaveValue('entered');
      expect(countInput()).toHaveValue(-1);
      expect(field(SUBNETS).findMultiselect()?.findTokens()[0]?.getElement()).toHaveTextContent('subnet-a');
      expect(field(GROUPS).findMultiselect()?.findTokens()[0]?.getElement()).toHaveTextContent('frontend');
      expect(publicIp()).not.toBeChecked();
    } else {
      expect(labeledField('Service name').findError()?.getElement()).toHaveTextContent('Enter a service name.');
      expect(labeledField(SUBNETS).findError()?.getElement()).toHaveTextContent('Choose at least one subnet.');
    }
    expect(calls('CreateService')).toHaveLength(0);
  },
);

it.each([false, true])('cancels immediately while at defaults, after editing = %s', async (changed) => {
  const { router } = open();
  await screen.findByRole('textbox', { name: 'Service name' });
  if (changed) {
    fireEvent.change(nameInput(), { target: { value: 'temp' } });
    fireEvent.change(nameInput(), { target: { value: '' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(CLUSTER));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls('CreateService')).toHaveLength(0);
});

it('keeps dirty input and returns focus on every dismissal, then discards to the cluster', async () => {
  const { router } = open();
  await fill();
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  for (const action of ['Keep editing', 'Escape', 'Close']) {
    fireEvent.click(cancel);
    const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    if (action === 'Escape') {
      fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape', code: 'Escape', keyCode: 27 });
    } else {
      fireEvent.click(within(dialog).getByRole('button', { name: action }));
    }
    expect(cancel).toHaveFocus();
    expectKept();
    expect(router.state.location.pathname).toBe(FORM);
  }
  fireEvent.click(cancel);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(CLUSTER));
  expect(calls('CreateService')).toHaveLength(0);
});

it('sends no second create during Creating service', async () => {
  const held = deferred<unknown>();
  emulator.mockImplementation((op) => (op === 'CreateService' ? held.promise : normal(op)));
  open();
  await fill();
  const button = submitButton();
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Creating service' });
  const form = button.closest('form');
  if (!form) throw new Error('Missing form');
  fireEvent.submit(form);
  expect(calls('CreateService')).toHaveLength(1);
  held.resolve(reply({ service: SERVICE }));
  expect((await flashWithText('Service returned created.')).findContent()?.getElement()).toHaveTextContent(
    'Service returned created.',
  );
});

it('hands over to the returned service, keeps the flash through out-of-order refresh, and reads the service on return', async () => {
  const gate = deferred<unknown>();
  const service = deferred<unknown>();
  const refreshGate = deferred<unknown>();
  const refreshService = deferred<unknown>();
  emulator.mockImplementation((op, body) => {
    if (op === 'DescribeClusters' && calls(op).length === 3) return gate.promise;
    if (op === 'DescribeClusters' && calls(op).length === 4) return refreshGate.promise;
    if (op === 'DescribeServices' && calls(op).length === 1) return service.promise;
    if (op === 'DescribeServices' && calls(op).length === 2) return refreshService.promise;
    if (op === 'DescribeServices' && !(body as { services: string[] }).services.includes(ARN)) {
      throw new Error('Expected the cluster list to describe the returned ARN');
    }
    return normal(op);
  });
  const { router, client } = open();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await fill();
  fireEvent.click(submitButton());
  await waitFor(() => expect(router.state.location.pathname).toBe(DETAIL));
  expect(calls('CreateService')[0]?.[1]).toMatchObject({
    cluster: 'dev',
    serviceName: 'entered',
    taskDefinition: 'web:2',
    launchType: 'FARGATE',
    desiredCount: 0,
    networkConfiguration: SERVICE.networkConfiguration,
  });
  for (const queryKey of [
    ECS_KEYS.cluster('dev'),
    ECS_KEYS.clusterServices('dev'),
    ECS_KEYS.clusterTasks('dev'),
    serviceKey('dev', 'returned'),
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
  expect(calls('DescribeServices')).toHaveLength(0);
  gate.resolve(reply(ACTIVE));
  await waitFor(() => expect(calls('DescribeServices')).toHaveLength(1));
  service.resolve(reply({ services: [SERVICE] }));
  expect(await screen.findByText('subnet-a')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => {
    expect(calls('DescribeServices')).toHaveLength(2);
    expect(calls('DescribeClusters')).toHaveLength(4);
  });
  refreshService.resolve(reply({ services: [SERVICE] }));
  expect(await screen.findByText('subnet-a')).toBeInTheDocument();
  await act(async () => refreshGate.resolve(reply(ACTIVE)));
  await waitFor(() => expect(client.isFetching({ queryKey: ECS_KEYS.cluster('dev') })).toBe(0));
  expect(screen.getByRole('heading', { name: 'returned', level: 1 })).toBeInTheDocument();
  expect((await flashWithText('Service returned created.')).findContent()?.getElement()).toHaveTextContent(
    'Service returned created.',
  );
  const clusterLink = screen
    .getAllByRole('link', { name: 'dev' })
    .find((link) => link.getAttribute('href') === CLUSTER);
  if (!clusterLink) throw new Error('Missing cluster breadcrumb');
  fireEvent.click(clusterLink);
  const link = await screen.findByRole('link', { name: 'returned' });
  expect(link).toHaveAttribute('href', DETAIL);
  expect(calls('ListServices')).toHaveLength(1);
});

it.each([
  {
    title: 'The emulator did not create the service.',
    detail: duplicate,
    code: 'InvalidParameterException',
    rename: true,
    response: () => reply({ __type: 'InvalidParameterException', message: duplicate }, 400),
  },
  {
    title: 'The emulator did not create the service.',
    detail: 'The name contains invalid characters.',
    code: 'InvalidParameterException',
    response: () =>
      reply({ __type: 'InvalidParameterException', message: 'The name contains invalid characters.' }, 400),
  },
  {
    title: 'The emulator did not create the service.',
    detail: duplicate,
    code: 'ClientException',
    response: () => reply({ __type: 'ClientException', message: duplicate }, 400),
  },
  {
    title: 'Access denied',
    detail: 'CreateService was refused: policy denied creation',
    response: () => reply({ __type: 'AccessDeniedException', message: 'policy denied creation' }, 403),
  },
  {
    title: 'Not implemented by the emulator',
    detail: 'The emulator answered 501 Not Implemented for CreateService.',
    response: () => reply({}, 501),
    unsupported: true,
  },
  { title: 'The emulator did not answer', detail: 'probe timed out', response: () => gateError('emulator') },
  { title: undefined, detail: ENGINE, response: () => gateError('engine') },
])(
  'focuses and retains every value after the create refusal %j',
  async ({ title, detail, code, response, unsupported, rename }) => {
    let refused = true;
    emulator.mockImplementation((op) => (op === 'CreateService' && refused ? response() : normal(op)));
    const { router } = open();
    await fill();
    fireEvent.click(submitButton());
    const item = await flashWithText(detail, title === undefined ? 'header' : 'content');
    await waitFor(() => expect(item.getElement()).toContainElement(document.activeElement as HTMLElement));
    if (title !== undefined) {
      expect(item.findHeader()?.getElement()).toHaveTextContent(title);
      expect(item.findContent()?.getElement()).toHaveTextContent(code === undefined ? detail : `${code}: ${detail}`);
      expect(document.activeElement).toHaveAccessibleName(title);
      expect(document.activeElement).toHaveAccessibleDescription(expect.stringContaining(detail) as string);
    } else {
      const header = `The EmuForge engine at ${detail} did not answer`;
      expect(item.findHeader()?.getElement()).toHaveTextContent(header);
      expect(document.activeElement).toHaveAccessibleName(header);
    }
    expect(router.state.location.pathname).toBe(FORM);
    expectKept();
    if (rename) {
      expect(labeledField('Service name').findError()?.getElement()).toHaveTextContent(
        'Choose a different service name.',
      );
      expect(nameInput()).toHaveAccessibleDescription('Choose a different service name.');
    } else {
      expect(labeledField('Service name').findError()).toBeNull();
    }
    if (unsupported) {
      expect(submitButton()).toBeDisabled();
      const dismiss = item.findDismissButton();
      if (!dismiss) throw new Error('Missing Flashbar dismiss button');
      fireEvent.click(dismiss.getElement());
      await waitFor(() => expect(flashItems()).toHaveLength(0));
      expect(submitButton()).toBeDisabled();
      expect(submitButton()).toHaveAccessibleDescription(detail);
      expect(within(submitButton().closest('form') as HTMLFormElement).getByText(detail)).toBeVisible();
      expectKept();
      fireEvent.click(submitButton());
      expect(calls('CreateService')).toHaveLength(1);
    } else {
      refused = false;
      fireEvent.change(nameInput(), { target: { value: 'corrected' } });
      expect(labeledField('Service name').findError()).toBeNull();
      fireEvent.click(submitButton());
      await waitFor(() => expect(router.state.location.pathname).toBe(DETAIL));
      expect(calls('CreateService')[1]?.[1]).toMatchObject({ serviceName: 'corrected' });
    }
  },
);

it('focuses the latest diagnostic after another refused submission', async () => {
  let diagnostic = duplicate;
  emulator.mockImplementation((op) =>
    op === 'CreateService' ? reply({ __type: 'InvalidParameterException', message: diagnostic }, 400) : normal(op),
  );
  open();
  await fill();
  fireEvent.click(submitButton());
  const first = await flashWithText(duplicate);
  expect(first.getElement()).toContainElement(document.activeElement as HTMLElement);
  expect(document.activeElement).toHaveAccessibleDescription(expect.stringContaining(duplicate) as string);

  diagnostic = 'The name contains invalid characters.';
  fireEvent.change(nameInput(), { target: { value: 'corrected' } });
  fireEvent.click(submitButton());
  const next = await flashWithText(diagnostic);
  expect(next.getElement()).toContainElement(document.activeElement as HTMLElement);
  expect(document.activeElement).toHaveAccessibleDescription(expect.stringContaining(diagnostic) as string);
  expect(labeledField('Service name').findError()).toBeNull();
  expect(calls('CreateService')).toHaveLength(2);
});
