import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import { ECS_KEYS } from '../queries';
import * as running from '../run-api';
import type { RunRequest } from '../run-form';
import { RunTaskPage } from './run-task-page';

// S6 with the calls answered by the case: the cluster's gate (`getCluster`), the run (`runTask`), and the choices'
// reads: the families' and revisions' at `api.ts`'s `sendEcs`, which a fake client behind answers by operation, the
// subnets' at the area's `listSubnetChoices` and the groups' at the reader of the area's security group source
// (`definition-choices.test.ts`, `run-queries.test.tsx` and `run-api.test.ts` prove the calls themselves). The pages a run leads to are later
// units', so most cases render the page alone under a flash that records what it is handed and leads to its address;
// the cases of "Cancel" render the area, whose root the discard dialog opens in.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getCluster: vi.fn(), listClusters: vi.fn(), sendEcs: vi.fn() };
});

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listSubnetChoices: vi.fn() };
});

// The area's source reads through its own module's reader, which a mock of the module cannot reach from inside it;
// the page is given the area's own source, with its reader answered by the case.
const readGroups = vi.fn<(vpcId: string | undefined) => Promise<{ items: { id: string; name: string }[] }>>();
vi.mock('../../../components/security-group-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../components/security-group-choices')>();
  return {
    ...real,
    securityGroupChoices: (endpoint: string | undefined, vpcId?: string) => ({
      ...real.securityGroupChoices(endpoint, vpcId),
      read: () => readGroups(vpcId),
    }),
  };
});

vi.mock('../run-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../run-api')>();
  return { ...real, runTask: vi.fn() };
});

// ---------------------------------------------------------------------------------------------------------------
// The emulator as the choices read it.

const ARN = (value: string) => `arn:aws:ecs:us-east-1:000000000000:task-definition/${value}`;

let families: string[];
let revisions: Record<string, string[]>;
let subnets: { SubnetId: string; VpcId: string; AvailabilityZone: string }[];
const GROUPS: Record<string, { GroupId: string; GroupName: string }[]> = {
  'vpc-1': [
    { GroupId: 'sg-1', GroupName: 'default' },
    { GroupId: 'sg-2', GroupName: 'web' },
  ],
  'vpc-2': [{ GroupId: 'sg-9', GroupName: 'other' }],
};

interface Input {
  familyPrefix?: string;
}

function answerEcs(operation: string, input: Input): unknown {
  if (operation === 'ListTaskDefinitionFamilies') {
    return { families };
  }
  if (operation === 'ListTaskDefinitions') {
    return { taskDefinitionArns: (revisions[input.familyPrefix ?? ''] ?? []).map(ARN) };
  }
  throw new Error(`unexpected ${operation}`);
}

function fakeSender(answer: (operation: string, input: Input) => unknown) {
  return (
    _endpoint: string,
    operation: string,
    send: (client: never, abortSignal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
  ) =>
    send(
      {
        send: (command: { input: Input }) => Promise.resolve(answer(operation, command.input)),
      } as never,
      signal,
    );
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it, and the page alone.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;
}

const EMULATOR = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const ENGINE = 'http://127.0.0.1:8313';

let connection: Connection;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
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
      connection={current}
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

const RUN_PATH = '/aws/ecs/clusters/cluster/dev/tasks/run';
const CLUSTER_PATH = '/aws/ecs/clusters/cluster/dev';

function openArea() {
  const router = createMemoryRouter([{ path: '/aws/*', element: <AreaWithStudioProps /> }], {
    initialEntries: [RUN_PATH],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

function PageAlone({ flash }: { flash: PageFlash }) {
  const { cluster = '' } = useParams();
  return (
    <PageFlashContext value={flash}>
      <RunTaskPage connection={connection.value} params={{ cluster }} />
    </PageFlashContext>
  );
}

function openPage() {
  const handed: [string, FlashResult][] = [];
  const flash: PageFlash = {
    show: () => undefined,
    handOver: (to, result) => {
      handed.push([to, result]);
      void router.navigate(to);
    },
  };
  const router = createMemoryRouter(
    [
      { path: '/aws/ecs/clusters/cluster/:cluster/tasks/run', element: <PageAlone flash={flash} /> },
      { path: '/aws/ecs/clusters/cluster/:cluster', element: <p>The cluster&apos;s page</p> },
      { path: '/aws/ecs/clusters/cluster/:cluster/tasks/task/:task', element: <p>The task&apos;s page</p> },
      { path: '/aws/ecs/task-definitions/register', element: <p>The register page</p> },
    ],
    { initialEntries: [RUN_PATH] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client, handed };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  families = ['web', 'api'];
  revisions = { web: ['web:3', 'web:2'], api: ['api:7'] };
  subnets = [
    { SubnetId: 'subnet-a', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1a' },
    { SubnetId: 'subnet-b', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1b' },
    { SubnetId: 'subnet-c', VpcId: 'vpc-2', AvailabilityZone: 'us-east-1c' },
  ];
  vi.mocked(api.getCluster).mockResolvedValue({ found: true, cluster: { name: 'dev', status: 'ACTIVE' } });
  vi.mocked(api.listClusters).mockResolvedValue({ clusters: [] });
  vi.mocked(api.sendEcs).mockImplementation(fakeSender(answerEcs) as unknown as typeof api.sendEcs);
  vi.mocked(network.listSubnetChoices).mockImplementation((_endpoint, _token, _signal, vpc) =>
    Promise.resolve({
      choices: subnets
        .filter((subnet) => vpc === undefined || subnet.VpcId === vpc)
        .map((subnet) => ({ id: subnet.SubnetId, vpcId: subnet.VpcId, zone: subnet.AvailabilityZone })),
    }),
  );
  readGroups.mockReset();
  readGroups.mockImplementation((vpc) =>
    Promise.resolve({ items: (GROUPS[vpc ?? ''] ?? []).map((group) => ({ id: group.GroupId, name: group.GroupName })) }),
  );
  vi.mocked(running.runTask).mockReset();
  vi.mocked(running.runTask).mockResolvedValue({ taskIds: ['t1'], failures: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function selectIn(label: string) {
  const found = createWrapper(field(label).getElement()).findSelect();
  if (found === null) {
    throw new Error(`no select in ${label}`);
  }
  return found;
}

function multiIn(label: string) {
  const found = createWrapper(field(label).getElement()).findMultiselect();
  if (found === null) {
    throw new Error(`no multiselect in ${label}`);
  }
  return found;
}

const FAMILY = 'Task definition family';
const REVISION = 'Revision';
const COUNT = 'Number of tasks';
const SUBNETS = 'Subnets';
const GROUPS_LABEL = 'Security groups - optional';
const PUBLIC_IP = 'Public IP';

async function choose(label: string, value: string) {
  const select = selectIn(label);
  select.openDropdown();
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  select.selectOptionByValue(value);
}

async function chooseIn(label: string, value: string) {
  const multi = multiIn(label);
  multi.openDropdown();
  await waitFor(() => {
    expect(multi.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  multi.selectOptionByValue(value);
  multi.closeDropdown();
}

function countInput(): HTMLInputElement {
  const input = field(COUNT).getElement().querySelector('input');
  if (input === null) {
    throw new Error('no count input');
  }
  return input;
}

function publicIpBox(): HTMLInputElement {
  const box = createWrapper(field(PUBLIC_IP).getElement()).findCheckbox()?.findNativeInput().getElement();
  if (box === undefined) {
    throw new Error('no checkbox');
  }
  return box;
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());
const runButton = () => screen.getByRole('button', { name: 'Run task' });
const formAlert = () => {
  const form = document.querySelector('form');
  return form === null ? null : createWrapper(form).findAlert();
};

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

async function opened() {
  await waitFor(() => {
    expect(document.querySelector('form')).not.toBeNull();
  });
}

/** The form filled: the family `web` (its newest revision preset) and the subnet `subnet-a`. */
async function fill() {
  await choose(FAMILY, 'web');
  await waitFor(() => {
    expect(text(selectIn(REVISION).findTrigger().getElement())).toContain('web:3');
  });
  await chooseIn(SUBNETS, 'subnet-a');
}

function sentRequest(): RunRequest | undefined {
  return vi.mocked(running.runTask).mock.calls[0]?.[1];
}

describe('Run task', () => {
  it('the form → the fields of R4 with their texts, the public IP checked and its description shown', async () => {
    openPage();
    await opened();
    expect(screen.getByRole('heading', { level: 1, name: 'Run task' })).toBeInTheDocument();
    expect(screen.getByText('Runs a task of a task definition in cluster dev, on Fargate.')).toBeInTheDocument();
    for (const label of [FAMILY, REVISION, COUNT, SUBNETS, GROUPS_LABEL, PUBLIC_IP]) {
      expect(field(label)).toBeDefined();
    }
    expect(countInput().value).toBe('1');
    expect(text(field(COUNT).findConstraint()?.getElement())).toBe('A whole number from 1 to 10.');
    expect(publicIpBox().checked).toBe(true);
    expect(text(field(PUBLIC_IP).getElement())).toContain('Assign a public IP');
    expect(
      screen.getByText(
        "Without a public IP the emulator ends the task before it starts, as a task that cannot reach its image's registry.",
      ),
    ).toBeInTheDocument();
  });

  it('a family chosen → Revision shows its newest; a subnet chosen → that VPC’s groups, and only its subnets', async () => {
    openPage();
    await opened();
    await choose(FAMILY, 'web');
    await waitFor(() => {
      expect(text(selectIn(REVISION).findTrigger().getElement())).toContain('web:3');
    });
    await choose(FAMILY, 'api');
    await waitFor(() => {
      expect(text(selectIn(REVISION).findTrigger().getElement())).toContain('api:7');
    });

    expect(text(field(GROUPS_LABEL).getElement())).toContain('Choose a subnet first.');
    await chooseIn(SUBNETS, 'subnet-a');
    const groups = multiIn(GROUPS_LABEL);
    groups.openDropdown();
    await waitFor(() => {
      expect(groups.findDropdown().findOptionByValue('sg-1')).not.toBeNull();
    });
    expect(groups.findDropdown().findOptionByValue('sg-2')).not.toBeNull();
    expect(groups.findDropdown().findOptionByValue('sg-9')).toBeNull();
    groups.closeDropdown();

    const subnetsField = multiIn(SUBNETS);
    subnetsField.openDropdown();
    await waitFor(() => {
      expect(subnetsField.findDropdown().findOptionByValue('subnet-b')).not.toBeNull();
    });
    expect(subnetsField.findDropdown().findOptionByValue('subnet-c')).toBeNull();
    subnetsField.closeDropdown();
  });

  it('submit with a field missing → its message, nothing sent', async () => {
    openPage();
    await opened();
    fireEvent.change(countInput(), { target: { value: '11' } });
    fireEvent.click(runButton());
    expect(errorOf(FAMILY)).toBe('Choose a task definition family.');
    expect(errorOf(REVISION)).toBe('Choose a revision.');
    expect(errorOf(COUNT)).toBe('Enter a whole number from 1 to 10.');
    expect(errorOf(SUBNETS)).toBe('Choose at least one subnet.');
    expect(running.runTask).not.toHaveBeenCalled();
  });

  it('one task answered → its page with "Task {task} started."; three of three → the cluster with "3 tasks started."', async () => {
    const first = openPage();
    await opened();
    await fill();
    fireEvent.click(runButton());
    expect(await screen.findByText("The task's page")).toBeInTheDocument();
    expect(sentRequest()).toEqual({
      cluster: 'dev',
      taskDefinition: 'web:3',
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-a'], assignPublicIp: 'ENABLED' } },
    });
    expect(first.handed).toEqual([
      ['/aws/ecs/clusters/cluster/dev/tasks/task/t1', [{ type: 'success', content: 'Task t1 started.' }]],
    ]);
    first.router.dispose();
  });

  it('three answered of three → the cluster\'s page with "3 tasks started."', async () => {
    vi.mocked(running.runTask).mockResolvedValue({ taskIds: ['t1', 't2', 't3'], failures: [] });
    const { handed, router } = openPage();
    await opened();
    await fill();
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(runButton());
    expect(await screen.findByText("The cluster's page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    expect(handed).toEqual([[CLUSTER_PATH, [{ type: 'success', content: '3 tasks started.' }]]]);
  });

  it('two of three with a failure → the cluster with the warning; none with a failure → the form stays', async () => {
    vi.mocked(running.runTask).mockResolvedValueOnce({ taskIds: [], failures: ['RESOURCE:ENI'] });
    const { handed, router } = openPage();
    await opened();
    await fill();
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(runButton());
    await waitFor(() => {
      expect(text(formAlert()?.getElement())).toContain('The emulator did not run the task.');
    });
    expect(text(formAlert()?.getElement())).toContain('RESOURCE:ENI');
    expect(router.state.location.pathname).toBe(RUN_PATH);
    expect(handed).toEqual([]);

    vi.mocked(running.runTask).mockResolvedValueOnce({ taskIds: ['t1', 't2'], failures: ['RESOURCE:MEMORY'] });
    fireEvent.click(runButton());
    expect(await screen.findByText("The cluster's page")).toBeInTheDocument();
    expect(handed).toHaveLength(1);
    const [to, result] = handed[0] ?? [];
    expect(to).toBe(CLUSTER_PATH);
    expect(result?.[0].type).toBe('warning');
    expect(result?.[0].header).toBe('2 of 3 tasks started.');
    render(<div data-testid="reasons">{result?.[0].content}</div>);
    expect(text(screen.getByTestId('reasons'))).toBe('RESOURCE:MEMORY');
  });

  it('a refusal → the form stays with its code and message above the fields, every value kept', async () => {
    vi.mocked(running.runTask).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'RunTask',
        code: 'InvalidParameterException',
        message: 'TaskDefinition is inactive',
      }),
    );
    const { router } = openPage();
    await opened();
    await fill();
    fireEvent.change(countInput(), { target: { value: '2' } });
    fireEvent.click(publicIpBox());
    fireEvent.click(runButton());
    await waitFor(() => {
      expect(formAlert()).not.toBeNull();
    });
    const alert = text(formAlert()?.getElement());
    expect(alert).toContain('The emulator did not run the task.');
    expect(alert).toContain('InvalidParameterException');
    expect(alert).toContain('TaskDefinition is inactive');
    // Above the fields: the alert comes before the first field in the form.
    const first = field(FAMILY).getElement();
    const alertElement = formAlert()?.getElement();
    expect(alertElement && alertElement.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(router.state.location.pathname).toBe(RUN_PATH);
    expect(text(selectIn(FAMILY).findTrigger().getElement())).toContain('web');
    expect(text(selectIn(REVISION).findTrigger().getElement())).toContain('web:3');
    expect(countInput().value).toBe('2');
    expect(publicIpBox().checked).toBe(false);
    expect((multiIn(SUBNETS).findTokens() ?? []).map((token) => text(token.findLabel().getElement()))).toEqual([
      expect.stringContaining('subnet-a'),
    ]);
    expect(sentRequest()?.networkConfiguration.awsvpcConfiguration.assignPublicIp).toBe('DISABLED');
  });

  it('no active family → "No task definitions. Register one first." with its link; no subnet → "No subnets in the local emulator."', async () => {
    families = [];
    subnets = [];
    openPage();
    await opened();
    await waitFor(() => {
      expect(text(field(FAMILY).getElement())).toContain('No task definitions. Register one first.');
    });
    const link = screen.getByRole('link', { name: 'Register one first.' });
    expect(link.getAttribute('href')).toBe('/aws/ecs/task-definitions/register');
    await waitFor(() => {
      expect(text(field(SUBNETS).getElement())).toContain('No subnets in the local emulator.');
    });
    fireEvent.click(link);
    expect(await screen.findByText('The register page')).toBeInTheDocument();
  });

  it('while the request is out → "Run task" disabled; "Cancel" untouched leaves, changed asks first', async () => {
    let answer: (value: running.RunOutcome) => void = () => undefined;
    vi.mocked(running.runTask).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { router } = openArea();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();

    void router.navigate(RUN_PATH);
    await opened();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(RUN_PATH);

    fireEvent.click(runButton());
    await waitFor(() => {
      expect(isDisabled(runButton())).toBe(true);
    });
    fireEvent.click(runButton());
    expect(running.runTask).toHaveBeenCalledTimes(1);
    answer({ taskIds: ['t1'], failures: [] });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/dev/tasks/task/t1');
    });
  });

  it('"Cancel" changed → "Discard" leaves to the cluster\'s page', async () => {
    const { router } = openArea();
    await opened();
    fireEvent.click(publicIpBox());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
  });

  it("the cluster not found → the cluster's not-found state and no form", async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    openPage();
    expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(api.sendEcs).not.toHaveBeenCalled();
    expect(network.listSubnetChoices).not.toHaveBeenCalled();
    expect(readGroups).not.toHaveBeenCalled();
  });

  it("a run that started tasks → the route and flash of the result, the cluster's read and its tasks' reads stale", async () => {
    const { client, handed, router } = openPage();
    const tasksKey = [...ECS_KEYS.clusterTasks('dev'), 'RUNNING', null];
    const clusterKey = [...ECS_KEYS.cluster('dev'), 'held'];
    const otherKey = [...ECS_KEYS.cluster('other'), 'held'];
    client.setQueryData(tasksKey, 'held');
    client.setQueryData(clusterKey, 'held');
    client.setQueryData(otherKey, 'held');
    await opened();
    await fill();
    fireEvent.click(runButton());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/dev/tasks/task/t1');
    });
    expect(handed[0]?.[1]).toEqual([{ type: 'success', content: 'Task t1 started.' }]);
    expect(client.getQueryState(tasksKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(clusterKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it('three started → to the cluster\'s address with "3 tasks started.", its reads stale', async () => {
    vi.mocked(running.runTask).mockResolvedValue({ taskIds: ['t1', 't2', 't3'], failures: [] });
    const { client, handed, router } = openPage();
    const tasksKey = [...ECS_KEYS.clusterTasks('dev'), 'STOPPED', null];
    client.setQueryData(tasksKey, 'held');
    await opened();
    await fill();
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(runButton());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(handed).toEqual([[CLUSTER_PATH, [{ type: 'success', content: '3 tasks started.' }]]]);
    expect(client.getQueryState(tasksKey)?.isInvalidated).toBe(true);
  });

  it('the page names "services and tasks" to the frame', async () => {
    openArea();
    expect(await screen.findByText('These services and tasks are in your local emulator')).toBeInTheDocument();
  });
});
