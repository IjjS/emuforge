import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function labeledField(label: string) {
  const field = createWrapper(document.body)
    .findAllFormFields()
    .find((each) => each.findLabel()?.getElement().textContent === label);
  if (!field) throw new Error(`Missing field ${label}`);
  return field;
}

function wrapper(label: string) {
  return createWrapper(labeledField(label).getElement());
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

async function choiceDiagnostic(label: string) {
  return createWrapper(await screen.findByRole('group', { name: `${label} diagnostic` }));
}

function emptyChoiceMessage(label: string) {
  return waitFor(() => {
    const state = wrapper(label).getElement().parentElement?.parentElement?.nextElementSibling;
    const message = state && createWrapper(state).findBox()?.getElement();
    if (!message) throw new Error(`Missing empty message for ${label}`);
    return message;
  });
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

function loadMoreButton(picker: ReturnType<typeof select> | ReturnType<typeof multi>) {
  return waitFor(() => {
    const menu = picker.findDropdown().findOpenDropdown()?.getElement();
    if (!menu) throw new Error('Missing open choice menu');
    const button = createWrapper(menu).findButton()?.getElement();
    if (!button) throw new Error('Missing continuation button');
    expect(button).toHaveTextContent('Load more');
    return button;
  });
}

async function loadMore(picker: ReturnType<typeof select> | ReturnType<typeof multi>) {
  fireEvent.click(await loadMoreButton(picker));
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
  await loadMore(select(FAMILY));
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

  await loadMore(before);

  const diagnostic = await screen.findByRole('group', { name: `${REVISION} diagnostic` });
  expect(diagnostic).toHaveTextContent('501 Not Implemented for ListTaskDefinitions');
  const after = select(REVISION);
  expect(menu).not.toBeInTheDocument();
  expect(after.findTrigger().getElement()).toBeDisabled();
  expect(after.findTrigger().getElement()).toHaveTextContent('web:2');
  openDropdown(after);
  expect(after.findDropdown().findOpenDropdown()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(answers.mock.calls.filter(([op]) => op === operation).map(([, input]) => input.nextToken)).toEqual([
    undefined,
    'older',
  ]);
});

it.each(['picker', 'another field', 'nonfocusable content'] as const)(
  'handles focus on a pending continuation 501 after moving to %s',
  async (destination) => {
    const operation = 'ListTaskDefinitions';
    let refuse: (error: RequestError) => void = () => undefined;
    const continuation = new Promise((_resolve, rejectPage) => {
      refuse = rejectPage;
    });
    answers.mockImplementation((op, input) => {
      if (op !== operation) return normal(op, input);
      return input.nextToken ? continuation : page(['web:3', 'web:2'], 'older');
    });

    const user = userEvent.setup();
    await open();
    await choose(FAMILY, 'web');
    await choose(REVISION, 'web:2');
    openDropdown(select(REVISION));
    const more = await loadMoreButton(select(REVISION));
    more.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(more).toHaveAttribute('aria-disabled', 'true'));
    expect(more).toHaveFocus();

    const name = screen.getByRole('textbox', { name: 'Service name' });
    if (destination === 'another field') {
      name.focus();
      expect(name).toHaveFocus();
    } else if (destination === 'nonfocusable content') {
      const description = createWrapper(document.body).findHeader()?.findDescription()?.getElement();
      if (!description) throw new Error('Missing nonfocusable header description');
      await user.click(description);
      expect(document.body).toHaveFocus();
    }
    await act(async () => refuse(new RequestError({ kind: 'not-implemented', operation })));

    const diagnostic = await screen.findByRole('group', { name: `${REVISION} diagnostic` });
    expect(createWrapper(diagnostic).findStatusIndicator()?.getElement()).toHaveTextContent(
      /^Not implemented by the emulator$/,
    );
    expect(diagnostic).toHaveAccessibleDescription(
      /501 Not Implemented for ListTaskDefinitions\. Studio cannot load more revisions\./,
    );
    expect(select(REVISION).findTrigger().getElement()).toBeDisabled();
    expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2');
    expect(select(REVISION).findDropdown().findOpenDropdown()).toBeNull();
    if (destination === 'another field') {
      expect(name).toHaveFocus();
    } else if (destination === 'nonfocusable content') {
      expect(document.body).toHaveFocus();
    } else {
      expect(diagnostic).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('spinbutton', { name: 'Desired tasks' })).toHaveFocus();
    }
    expect(answers.mock.calls.filter(([op]) => op === operation).map(([, input]) => input.nextToken)).toEqual([
      undefined,
      'older',
    ]);
  },
);

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
  await loadMore(select(REVISION));
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
  await loadMore(select(REVISION));
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
  expect(await emptyChoiceMessage(REVISION)).toHaveTextContent('This family has no active Fargate revisions.');
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
  const description = await waitFor(() => {
    const message = labeledField(FAMILY).findDescription()?.getElement();
    if (!message) throw new Error('Missing empty family description');
    return message;
  });
  expect(description).toHaveTextContent('No task definitions.');
  expect(screen.getByRole('link', { name: 'Register one first.' })).toHaveAttribute(
    'href',
    '/aws/ecs/task-definitions/register',
  );
});

it('reports an empty subnet list', async () => {
  vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [] });
  await open();
  expect(await emptyChoiceMessage(SUBNETS)).toHaveTextContent(/^No subnets in the local emulator\.$/);
});

it('asks for a subnet before any groups can be read', async () => {
  await open();
  const trigger = multi(GROUPS).findTrigger().getElement();
  expect(trigger).toHaveTextContent(/^Choose a subnet first\.$/);
  expect(trigger).toBeDisabled();
  expect(readGroups).not.toHaveBeenCalled();
});

it('reports a successful empty group list in the selected VPC', async () => {
  readGroups.mockResolvedValue({ items: [] });
  await open();
  await choose(SUBNETS, 'subnet-a');
  expect(await emptyChoiceMessage(GROUPS)).toHaveTextContent(/^No security groups in this VPC\.$/);
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
  await loadMore(multi(SUBNETS));
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
  await loadMore(multi(GROUPS));
  await waitFor(() => expect(multi(GROUPS).findDropdown().findOptionByValue('sg-b')).not.toBeNull());
  multi(GROUPS).selectOptionByValue('sg-b');
  expect(multi(GROUPS).findTokens()).toHaveLength(1);
  expect(readGroups).toHaveBeenCalledWith('vpc-1', 'groups-2');
});

it('distinguishes security group options and sends the chosen group ID', async () => {
  const identity = 'dev\\u0020\\u0020group';
  readGroups.mockResolvedValue({
    items: [
      { ...groupA, name: 'dev group' },
      { ...groupB, name: 'dev  group' },
    ],
  });
  answers.mockImplementation((operation, input) =>
    operation === 'CreateService' ? { service: { serviceName: 'entered' } } : normal(operation, input),
  );
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Service name' }), { target: { value: 'entered' } });
  await choose(FAMILY, 'web');
  await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2'));
  await choose(SUBNETS, subnetA.id);

  const picker = multi(GROUPS);
  openDropdown(picker);
  const dropdown = picker.findDropdown();
  await waitFor(() => {
    expect(dropdown.findOptionByValue(groupA.id)?.findLabel().getElement().textContent).toBe('dev group');
    expect(dropdown.findOptionByValue(groupB.id)?.findLabel().getElement().textContent).toBe(identity);
  });
  await choose(GROUPS, groupB.id);
  expect(picker.findTokens().map((token) => token.findLabel().getElement().textContent)).toEqual([identity]);
  expect(picker.findToken(1)?.findDismiss()?.getElement()).toHaveAccessibleName(`Remove ${identity}`);

  fireEvent.click(screen.getByRole('button', { name: 'Create service' }));
  await waitFor(() =>
    expect(answers).toHaveBeenCalledWith(
      'CreateService',
      expect.objectContaining({
        networkConfiguration: expect.objectContaining({
          awsvpcConfiguration: expect.objectContaining({ securityGroups: [groupB.id] }),
        }),
      }),
    ),
  );
});

it('keeps groups until the last subnet is removed and scopes new choices to the new VPC', async () => {
  await open();
  await choose(SUBNETS, 'subnet-a');
  await choose(SUBNETS, 'subnet-b');
  await choose(GROUPS, 'sg-a');
  const first = multi(SUBNETS).findTokens()[0];
  if (!first) throw new Error('Missing first subnet token');
  expect(first.findLabel().getElement()).toHaveTextContent('subnet-a');
  expect(first.findDismiss().getElement()).toHaveAccessibleName('Remove subnet-a');
  fireEvent.click(first.findDismiss().getElement());
  expect(multi(GROUPS).findTokens()).toHaveLength(1);
  const remaining = multi(SUBNETS).findTokens()[0];
  if (!remaining) throw new Error('Missing remaining subnet token');
  expect(remaining.findLabel().getElement()).toHaveTextContent('subnet-b');
  expect(remaining.findDismiss().getElement()).toHaveAccessibleName('Remove subnet-b');
  fireEvent.click(remaining.findDismiss().getElement());
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
  const diagnostic = await choiceDiagnostic(REVISION);
  expect(diagnostic.getElement()).toHaveTextContent('DescribeTaskDefinition');
  expect(diagnostic.getElement()).toHaveTextContent('ClientException');
  expect(diagnostic.getElement()).toHaveTextContent('Unable to describe task definition.');
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
  const diagnostic = await choiceDiagnostic(label);
  expect(diagnostic.findStatusIndicator()?.getElement()).toHaveTextContent(/^Not implemented by the emulator$/);
  expect(diagnostic.getElement()).toHaveTextContent(new RegExp(`501.*${operation}`));
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
  const diagnostic = await choiceDiagnostic(FAMILY);
  expect(diagnostic.findStatusIndicator()?.getElement()).toHaveTextContent(/^Access denied$/);
  expect(diagnostic.getElement()).toHaveTextContent(
    'ListTaskDefinitionFamilies was refused: policy denied the family list',
  );
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
    const diagnostic = await choiceDiagnostic(REVISION);
    const indicator = diagnostic.findStatusIndicator()?.getElement();
    if (kind === 'engine-did-not-answer') {
      expect(indicator).toHaveTextContent(`The EmuForge engine at ${ENGINE} did not answer`);
      expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
    } else {
      expect(indicator).toHaveTextContent(/^The emulator did not answer$/);
      expect(diagnostic.findBox()?.getElement()).toHaveTextContent(/^probe timed out$/);
    }
    expect(screen.getByRole('textbox', { name: 'Service name' })).toHaveValue('entered');
    expect(select(FAMILY).findTrigger().getElement()).toHaveTextContent('web');
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(select(REVISION).findTrigger().getElement()).toHaveTextContent('web:2'));
  },
);
