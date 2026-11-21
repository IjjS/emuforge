import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import * as network from '../../../lib/ec2-network-choices';
import * as ecs from '../api';
import { CreateServicePage } from '../pages/create-service-page';

vi.mock('../api', async (original) => ({
  ...(await original<typeof ecs>()),
  getCluster: vi.fn(),
  sendEcs: vi.fn(),
}));
vi.mock('../../../lib/ec2-network-choices', async (original) => ({
  ...(await original<typeof network>()),
  listSubnetChoices: vi.fn(),
}));

const readGroups = vi.fn();
vi.mock('../../../components/security-group-choices', async (original) => {
  const real = await original<typeof import('../../../components/security-group-choices')>();
  return {
    ...real,
    securityGroupChoices: (endpoint: string | undefined, vpc?: string) => ({
      ...real.securityGroupChoices(endpoint, vpc),
      read: (_at: string, _text: string, token: string | undefined) => readGroups(vpc, token),
    }),
  };
});

const FAMILY = 'Task definition family';
const REVISION = 'Revision';
const SUBNETS = 'Subnets';
const GROUPS = 'Security groups';
const ENGINE = 'http://127.0.0.1:9609';
const definition = { status: 'ACTIVE', networkMode: 'awsvpc', compatibilities: ['FARGATE'] };
const arn = (revision: string) => `arn:aws:ecs:us-east-1:000000000000:task-definition/${revision}`;
const page = (names: string[], nextToken?: string) => ({ taskDefinitionArns: names.map(arn), nextToken });
const subnetA = { id: 'subnet-a', vpcId: 'vpc-1' };
const subnetB = { id: 'subnet-b', vpcId: 'vpc-1' };
const subnetC = { id: 'subnet-c', vpcId: 'vpc-2' };
const groupA = { id: 'sg-a', name: 'internal' };
const groupB = { id: 'sg-b', name: 'frontend' };
const groupC = { id: 'sg-c', name: 'isolated' };

interface ChoiceRequest {
  nextToken?: string;
  familyPrefix?: string;
  taskDefinition?: string;
}

const answers = vi.fn<(operation: string, input: ChoiceRequest) => unknown>();
const normal = (operation: string, input: ChoiceRequest): unknown => {
  switch (operation) {
    case 'ListTaskDefinitionFamilies':
      return { families: ['web', 'api'] };
    case 'ListTaskDefinitions':
      return page([`${input.familyPrefix}:2`]);
    case 'DescribeTaskDefinition':
      return { taskDefinition: definition };
    default:
      throw new Error(`Unexpected operation ${operation}`);
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  answers.mockImplementation(normal);
  vi.mocked(ecs.getCluster).mockResolvedValue({ found: true, cluster: { name: 'dev', status: 'ACTIVE' } });
  vi.mocked(ecs.sendEcs).mockImplementation((_endpoint, operation, send, signal) =>
    send(
      { send: (command: { input: ChoiceRequest }) => Promise.resolve(answers(operation, command.input)) } as never,
      signal,
    ),
  );
  vi.mocked(network.listSubnetChoices).mockImplementation(async (_at, _token, _signal, vpc) => ({
    choices: [subnetA, subnetB, subnetC].filter((subnet) => vpc === undefined || subnet.vpcId === vpc),
  }));
  readGroups.mockImplementation(async (vpc: string) => ({ items: vpc === 'vpc-1' ? [groupA, groupB] : [groupC] }));
});

afterEach(() => vi.unstubAllGlobals());

async function open(result: AreaConnection['result'] = undefined) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })}
    >
      <MemoryRouter>
        <CreateServicePage connection={{ engineOrigin: ENGINE, result }} params={{ cluster: 'dev' }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('textbox', { name: 'Service name' });
}

function wrapper(label: string) {
  const field = createWrapper(document.body)
    .findAllFormFields()
    .find((each) => each.findLabel()?.getElement().textContent === label);
  if (!field) throw new Error(`Missing field ${label}`);
  return createWrapper(field.getElement());
}

function select(label: string) {
  const found = wrapper(label).findSelect();
  if (!found) throw new Error(`Missing select ${label}`);
  return found;
}

function multi(label: string) {
  const found = wrapper(label).findMultiselect();
  if (!found) throw new Error(`Missing multiselect ${label}`);
  return found;
}

function openDropdown(input: ReturnType<typeof select> | ReturnType<typeof multi>) {
  if (input.findTrigger().getElement().getAttribute('aria-expanded') !== 'true') input.openDropdown();
}

async function choose(label: string, id: string) {
  const input = label === SUBNETS || label === GROUPS ? multi(label) : select(label);
  openDropdown(input);
  await waitFor(() => expect(input.findDropdown().findOptionByValue(id)).not.toBeNull());
  input.selectOptionByValue(id);
  if (label === SUBNETS || label === GROUPS) {
    input.closeDropdown();
  }
}

function loadMore() {
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
}

function reject(failure: RequestFailure): never {
  throw new RequestError(failure);
}

it('loads a later ACTIVE family page using the returned continuation', async () => {
  answers.mockImplementation((operation, input) =>
    operation !== 'ListTaskDefinitionFamilies'
      ? normal(operation, input)
      : input.nextToken
        ? { families: ['api'] }
        : { families: ['web'], nextToken: 'families-2' },
  );
  await open();
  openDropdown(select(FAMILY));
  await screen.findByRole('button', { name: 'Load more' });
  loadMore();
  await waitFor(() => expect(select(FAMILY).findDropdown().findOptionByValue('api')).not.toBeNull());
  select(FAMILY).selectOptionByValue('api');
  expect(select(FAMILY).findTrigger().getElement()).toHaveTextContent('api');
  expect(answers.mock.calls.filter(([op]) => op === 'ListTaskDefinitionFamilies')).toEqual([
    ['ListTaskDefinitionFamilies', { status: 'ACTIVE', maxResults: 50 }],
    ['ListTaskDefinitionFamilies', { status: 'ACTIVE', maxResults: 50, nextToken: 'families-2' }],
  ]);
});

it('closes an open revision menu on continuation 501 and keeps the chosen revision', async () => {
  const operation = 'ListTaskDefinitions';
  answers.mockImplementation((op, input) => {
    if (op !== operation) return normal(op, input);
    if (input.nextToken) reject({ kind: 'not-implemented', operation });
    return page(['web:3', 'web:2'], 'older');
  });
  await open();
  await choose(FAMILY, 'web');
  await choose(REVISION, 'web:2');
  const before = select(REVISION);
  openDropdown(before);
  const menu = before.findDropdown().findOpenDropdown()?.getElement();
  expect(menu).toBeInTheDocument();
  expect(before.findDropdown().findOptionByValue('web:3')?.getElement()).toBeVisible();

  loadMore();

  const diagnostic = await screen.findByRole('group', { name: `${REVISION} diagnostic` });
  expect(diagnostic).toHaveTextContent('501 Not Implemented for ListTaskDefinitions');
  const after = select(REVISION);
  expect(menu).not.toBeInTheDocument();
  expect(after.findTrigger().getElement()).toBeDisabled();
  expect(after.findTrigger().getElement()).toHaveTextContent('web:2');
  openDropdown(after);
  expect(after.findDropdown().findOpenDropdown()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(answers.mock.calls.filter(([op]) => op === operation).map(([, input]) => input.nextToken)).toEqual([
    undefined,
    'older',
  ]);
});

it('uses the first eligible page for the preset and options, then chooses an older revision', async () => {
  answers.mockImplementation((op, input) => {
    if (op === 'ListTaskDefinitions') {
      if (input.nextToken === 'older') return page(['web:1']);
      if (input.nextToken === 'middle') return page(['web:3'], 'older');
      return page(['web:4'], 'middle');
    }
    return input.taskDefinition === 'web:3'
      ? { taskDefinition: { ...definition, networkMode: 'bridge' } }
      : normal(op, input);
  });
  await open();
  await choose(FAMILY, 'web');
  await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:4'));
  openDropdown(select(REVISION));
  expect(select(REVISION).findDropdown().findOptionByValue('web:4')).not.toBeNull();
  loadMore();
  await waitFor(() => expect(select(REVISION).findDropdown().findOptionByValue('web:1')).not.toBeNull());
  select(REVISION).selectOptionByValue('web:1');
  expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:1');
  expect(answers.mock.calls.filter(([op]) => op === 'ListTaskDefinitions').map(([, input]) => input.nextToken)).toEqual(
    [undefined, 'middle', 'older'],
  );
});

it('clears a preset on family change and ignores a delayed page from the old family', async () => {
  let resolveOlder: (value: unknown) => void = () => undefined;
  let resolveNew: (value: unknown) => void = () => undefined;
  const older = new Promise((resolve) => {
    resolveOlder = resolve;
  });
  const newFamily = new Promise((resolve) => {
    resolveNew = resolve;
  });
  answers.mockImplementation((op, input) => {
    if (op !== 'ListTaskDefinitions') return normal(op, input);
    if (input.familyPrefix === 'api') return newFamily;
    return input.nextToken === 'older' ? older : page(['web:2'], 'older');
  });
  await open();
  await choose(FAMILY, 'web');
  await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2'));
  openDropdown(select(REVISION));
  loadMore();
  await choose(FAMILY, 'api');
  expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('Choose a revision');
  await act(async () => resolveNew(page(['api:3'])));
  await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('api:3'));
  await act(async () => resolveOlder(page(['web:1'])));
  expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('api:3');
});

it('exhausts ineligible revision pages and links to registration', async () => {
  answers.mockImplementation((op, input) => {
    if (op === 'ListTaskDefinitions') return input.nextToken ? page(['web:1']) : page(['web:2'], 'older');
    return op === 'DescribeTaskDefinition'
      ? { taskDefinition: { ...definition, compatibilities: ['EC2'] } }
      : normal(op, input);
  });
  await open();
  await choose(FAMILY, 'web');
  expect(await screen.findByText('This family has no active Fargate revisions.')).toBeInTheDocument();
  expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('Choose a revision');
  expect(screen.getByRole('link', { name: 'Register task definition' })).toHaveAttribute(
    'href',
    '/aws/ecs/task-definitions/register',
  );
});

it('shows the registration entry for an empty family list', async () => {
  answers.mockImplementation((op, input) =>
    op === 'ListTaskDefinitionFamilies' ? { families: [] } : normal(op, input),
  );
  await open();
  expect(await screen.findByText('No task definitions.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Register one first.' })).toHaveAttribute(
    'href',
    '/aws/ecs/task-definitions/register',
  );
});

it('reports an empty subnet list', async () => {
  vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [] });
  await open();
  expect(await screen.findByText('No subnets in the local emulator.')).toBeInTheDocument();
});

it('asks for a subnet before any groups can be read', async () => {
  await open();
  expect(screen.getByText('Choose a subnet first.')).toBeInTheDocument();
  expect(multi(GROUPS).findTrigger().getElement()).toBeDisabled();
  expect(readGroups).not.toHaveBeenCalled();
});

it('reports a successful empty group list in the selected VPC', async () => {
  readGroups.mockResolvedValue({ items: [] });
  await open();
  await choose(SUBNETS, 'subnet-a');
  expect(await screen.findByText('No security groups in this VPC.')).toBeInTheDocument();
  expect(readGroups).toHaveBeenCalledWith('vpc-1', undefined);
});

it('loads another subnet on the selected VPC continuation', async () => {
  vi.mocked(network.listSubnetChoices).mockImplementation(async (_at, token, _signal, vpc) =>
    token
      ? { choices: [subnetB] }
      : vpc
        ? { choices: [subnetA], nextToken: 'subnets-2' }
        : { choices: [subnetA, subnetC] },
  );
  await open();
  await choose(SUBNETS, 'subnet-a');
  openDropdown(multi(SUBNETS));
  await screen.findByRole('button', { name: 'Load more' });
  loadMore();
  await waitFor(() => expect(multi(SUBNETS).findDropdown().findOptionByValue('subnet-b')).not.toBeNull());
  multi(SUBNETS).selectOptionByValue('subnet-b');
  expect(network.listSubnetChoices).toHaveBeenCalledWith(ENGINE, 'subnets-2', expect.any(AbortSignal), 'vpc-1');
  expect(multi(SUBNETS).findTokens()).toHaveLength(2);
});

it('loads a group on the selected VPC continuation', async () => {
  readGroups.mockImplementation(async (_vpc: string, token: string | undefined) =>
    token ? { items: [groupB] } : { items: [groupA], next: 'groups-2' },
  );
  await open();
  await choose(SUBNETS, 'subnet-a');
  openDropdown(multi(GROUPS));
  await screen.findByRole('button', { name: 'Load more' });
  loadMore();
  await waitFor(() => expect(multi(GROUPS).findDropdown().findOptionByValue('sg-b')).not.toBeNull());
  multi(GROUPS).selectOptionByValue('sg-b');
  expect(multi(GROUPS).findTokens()).toHaveLength(1);
  expect(readGroups).toHaveBeenCalledWith('vpc-1', 'groups-2');
});

it('keeps groups until the last subnet is removed and scopes new choices to the new VPC', async () => {
  await open();
  await choose(SUBNETS, 'subnet-a');
  await choose(SUBNETS, 'subnet-b');
  await choose(GROUPS, 'sg-a');
  fireEvent.click(screen.getByRole('button', { name: 'Remove subnet-a' }));
  expect(multi(GROUPS).findTokens()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove subnet-b' }));
  expect(multi(GROUPS).findTokens()).toHaveLength(0);
  await choose(SUBNETS, 'subnet-c');
  openDropdown(multi(SUBNETS));
  await waitFor(() => expect(multi(SUBNETS).findDropdown().findOptionByValue('subnet-c')).not.toBeNull());
  expect(multi(SUBNETS).findDropdown().findOptionByValue('subnet-a')).toBeNull();
  await choose(GROUPS, 'sg-c');
  expect(readGroups).toHaveBeenCalledWith('vpc-2', undefined);
  openDropdown(multi(GROUPS));
  expect(multi(GROUPS).findDropdown().findOptionByValue('sg-a')).toBeNull();
});

it('retries the failed revision description and keeps the family and name', async () => {
  let refused = true;
  answers.mockImplementation((op, input) => {
    if (op === 'DescribeTaskDefinition' && refused) {
      reject({ kind: 'other', operation: op, code: 'ClientException', message: 'Unable to describe task definition.' });
    }
    return normal(op, input);
  });
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Service name' }), { target: { value: 'entered' } });
  await choose(FAMILY, 'web');
  expect(await screen.findByText('DescribeTaskDefinition')).toBeInTheDocument();
  expect(screen.getByText('ClientException')).toBeInTheDocument();
  expect(screen.getByText(/Unable to describe task definition/)).toBeInTheDocument();
  refused = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2'));
  expect(select(FAMILY).findTrigger().getElement()).toHaveTextContent('web');
  expect(screen.getByRole('textbox', { name: 'Service name' })).toHaveValue('entered');
});

it.each([
  [FAMILY, 'ListTaskDefinitionFamilies'],
  [REVISION, 'DescribeTaskDefinition'],
  [SUBNETS, 'DescribeSubnets'],
  [GROUPS, 'DescribeSecurityGroups'],
])('locks only the unsupported %s control and names %s', async (label, operation) => {
  const fail = () => reject({ kind: 'not-implemented', operation });
  if (label === SUBNETS) vi.mocked(network.listSubnetChoices).mockImplementation(fail);
  else if (label === GROUPS) readGroups.mockImplementation(fail);
  else answers.mockImplementation((op, input) => (op === operation ? fail() : normal(op, input)));

  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Service name' }), { target: { value: 'entered' } });
  if (label === REVISION) await choose(FAMILY, 'web');
  if (label === GROUPS) await choose(SUBNETS, 'subnet-a');
  expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`501.*${operation}`))).toBeInTheDocument();
  const trigger = (label === SUBNETS || label === GROUPS ? multi(label) : select(label)).findTrigger().getElement();
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  const count =
    label === SUBNETS
      ? vi.mocked(network.listSubnetChoices).mock.calls.length
      : label === GROUPS
        ? readGroups.mock.calls.length
        : answers.mock.calls.filter(([op]) => op === operation).length;
  expect(count).toBe(1);
  expect(screen.getByRole('textbox', { name: 'Service name' })).toHaveValue('entered');
});

it('reports the operation and real reason for a denied choice', async () => {
  answers.mockImplementation((operation) =>
    reject({ kind: 'access-denied', operation, message: 'policy denied the family list' }),
  );
  await open();
  expect(await screen.findByText('Access denied')).toBeInTheDocument();
  expect(screen.getByText('ListTaskDefinitionFamilies was refused: policy denied the family list')).toBeInTheDocument();
});

it.each(['emulator-did-not-answer', 'engine-did-not-answer'] as const)(
  'retains values and retries a %s page',
  async (kind) => {
    let refused = true;
    answers.mockImplementation((operation, input) => {
      if (operation === 'ListTaskDefinitions' && refused) {
        reject(
          kind === 'emulator-did-not-answer' ? { kind, operation, message: 'probe timed out' } : { kind, operation },
        );
      }
      return normal(operation, input);
    });
    await open(
      kind === 'engine-did-not-answer'
        ? { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: undefined }
        : undefined,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Service name' }), { target: { value: 'entered' } });
    await choose(FAMILY, 'web');
    if (kind === 'engine-did-not-answer') {
      expect(await screen.findByText(ENGINE)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
    } else {
      expect(await screen.findByText('The emulator did not answer')).toBeInTheDocument();
      expect(screen.getByText('probe timed out')).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Service name' })).toHaveValue('entered');
    expect(select(FAMILY).findTrigger().getElement()).toHaveTextContent('web');
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2'));
  },
);
