import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import * as api from '../service-api';
import { ServicesTable, type ServicesTableProps } from './services-table';

// The table over `service-api.ts`, whose calls the case answers (`service-api.test.ts` proves the calls).

vi.mock('../service-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-api')>();
  return { ...real, listServices: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8313';
const CONNECTION = { result: undefined, engineOrigin: ENGINE };

function service(name: string, extra: Partial<api.Service> = {}): api.Service {
  return {
    name,
    arn: `arn:aws:ecs:us-east-1:0:service/dev/${name}`,
    status: 'ACTIVE',
    desired: 2,
    running: 2,
    pending: 0,
    definitionArn: 'arn:aws:ecs:us-east-1:0:task-definition/web:3',
    definition: { family: 'web', revision: 3 },
    launchType: 'FARGATE',
    deployments: [],
    events: [],
    ...extra,
  };
}

function open(props: Partial<ServicesTableProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ServicesTable connection={CONNECTION} cluster="dev" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return createWrapper(document.body);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

const headers = (wrapper: ReturnType<typeof createWrapper>) =>
  (wrapper.findTable()?.findColumnHeaders() ?? []).map((header) => header.getElement().textContent);

describe('the services table', () => {
  it('services read → the columns of R4, each name a link to the service, each definition to its revision', async () => {
    vi.mocked(api.listServices).mockResolvedValue({ services: [service('api', { running: 1, pending: 1 })] });
    const wrapper = open();
    const link = await screen.findByRole('link', { name: 'api' });
    expect(screen.getByRole('link', { name: 'Create service' })).toHaveAttribute(
      'href',
      '/aws/ecs/clusters/cluster/dev/services/create',
    );
    expect(link).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev/services/service/api');
    expect(screen.getByRole('link', { name: 'web:3' })).toHaveAttribute(
      'href',
      '/aws/ecs/task-definitions/family/web/revision/3',
    );
    expect(headers(wrapper)).toEqual([
      'Name',
      'Status',
      'Desired',
      'Running',
      'Pending',
      'Task definition',
      'Launch type',
    ]);
    const cells = (wrapper.findTable()?.findRows()[0]?.findAll('td') ?? []).map((cell) =>
      (cell.getElement().textContent ?? '').trim(),
    );
    expect(cells).toEqual(['Active', '2', '1', '1', 'web:3', 'FARGATE']);
    expect(vi.mocked(api.listServices).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', undefined]);
  });

  it('empty → "No services" with the cluster create action', async () => {
    vi.mocked(api.listServices).mockResolvedValue({ services: [] });
    open();
    expect(await screen.findByText('No services')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create service' })).toHaveAttribute(
      'href',
      '/aws/ecs/clusters/cluster/dev/services/create',
    );
  });

  it('a failed read → the failure state with a retry', async () => {
    vi.mocked(api.listServices)
      .mockRejectedValueOnce(
        new RequestError({
          kind: 'other',
          operation: 'ListServices',
          code: 'ClusterNotFoundException',
          message: 'gone',
        }),
      )
      .mockResolvedValue({ services: [service('api')] });
    open();
    await screen.findByText('The service list could not be read');
    expect(screen.getByText('ClusterNotFoundException')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    await screen.findByRole('link', { name: 'api' });
  });

  it('a page read again by following → the page told of each such read, not of the first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onFollowedRead = vi.fn();
    vi.mocked(api.listServices).mockImplementation(() =>
      Promise.resolve({ services: [service('api', { running: 1 })] }),
    );
    open({ onFollowedRead });
    await screen.findByRole('link', { name: 'api' });
    expect(api.listServices).toHaveBeenCalledTimes(1);
    expect(onFollowedRead).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(onFollowedRead).toHaveBeenCalledTimes(1);
    });
    expect(api.listServices).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => {
      expect(onFollowedRead).toHaveBeenCalledTimes(2);
    });
  });

  it('a settled page → not read again and nothing told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onFollowedRead = vi.fn();
    vi.mocked(api.listServices).mockImplementation(() => Promise.resolve({ services: [service('api')] }));
    open({ onFollowedRead });
    await screen.findByRole('link', { name: 'api' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(api.listServices).toHaveBeenCalledTimes(1);
    expect(onFollowedRead).not.toHaveBeenCalled();
  });
});
