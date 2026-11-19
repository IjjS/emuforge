import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import * as api from '../api';
import type { DeliveryProtocol } from '../api';
import { EndpointSelect, type EndpointChoice } from './endpoint-select';

// S4's endpoint field with the calls of `api.ts` answered by the case (`api.test.ts` proves the calls themselves).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listQueueChoices: vi.fn(), listFunctionChoices: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8314';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9314, endpoint: 'https://127.0.0.1:9314' } },
  engineOrigin: ENGINE,
};

const queue = (name: string): api.QueueChoice => ({ name, url: `https://127.0.0.1:9314/000000000000/${name}` });
const fn = (name: string): api.FunctionChoice => ({
  name,
  arn: `arn:aws:lambda:us-east-1:000000000000:function:${name}`,
});

let chosen: EndpointChoice | undefined;

function Field({ protocol }: { protocol: DeliveryProtocol }) {
  const [value, setValue] = useState<EndpointChoice>();
  return (
    <EndpointSelect
      engineOrigin={ENGINE}
      connection={CONNECTION}
      protocol={protocol}
      value={value}
      onChange={(choice) => {
        chosen = choice;
        setValue(choice);
      }}
    />
  );
}

function open(protocol: DeliveryProtocol) {
  const router = createMemoryRouter(
    [
      { path: '/form', element: <Field protocol={protocol} /> },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: ['/form'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function select() {
  const found = PAGE.findSelect();
  if (found === null) {
    throw new Error('no select');
  }
  return found;
}

function shown(): string[] {
  return (select().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
}

function dropdownText(): string {
  return text(select().findDropdown().getElement());
}

const failed = (code: string) =>
  new RequestError({ kind: 'other', operation: 'ListQueues', code, message: 'went wrong' });

beforeEach(() => {
  vi.clearAllMocks();
  chosen = undefined;
});

describe('the queues', () => {
  it('opened → "Loading queues", then the first page; "Load more" while a token remains → the next page added', async () => {
    let answer: (page: api.QueueChoicePage) => void = () => undefined;
    vi.mocked(api.listQueueChoices)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValueOnce({ choices: [queue('gamma')] });
    open('sqs');
    expect(PAGE.findFormField()?.findLabel()?.getElement().textContent).toBe('Queue');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading queues');
    });
    expect(vi.mocked(api.listQueueChoices).mock.calls[0]?.[1]).toEqual({});
    act(() => {
      answer({ choices: [queue('alpha'), queue('beta')], nextToken: 't-1' });
    });
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta', 'gamma']);
    });
    expect(vi.mocked(api.listQueueChoices).mock.calls[1]?.[1]).toEqual({ token: 't-1' });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    select().selectOptionByValue(queue('beta').url);
    expect(chosen).toEqual({ protocol: 'sqs', ...queue('beta') });
  });

  it('text typed → the choices start again with that prefix; none then → "No queues match"', async () => {
    vi.mocked(api.listQueueChoices)
      .mockResolvedValueOnce({ choices: [queue('alpha')], nextToken: 't-1' })
      .mockResolvedValueOnce({ choices: [queue('orders')] })
      .mockResolvedValueOnce({ choices: [] });
    open('sqs');
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha']);
    });
    select().findFilteringInput()?.setInputValue('ord');
    await waitFor(() => {
      expect(shown()).toEqual(['orders']);
    });
    expect(vi.mocked(api.listQueueChoices).mock.calls[1]?.[1]).toEqual({ prefix: 'ord' });
    select().findFilteringInput()?.setInputValue('zz');
    await waitFor(() => {
      expect(dropdownText()).toContain('No queues match');
    });
    expect(vi.mocked(api.listQueueChoices).mock.calls[2]?.[1]).toEqual({ prefix: 'zz' });
    expect(screen.queryByRole('link', { name: 'Create queue' })).toBeNull();
  });

  it('none → "No queues" with "Create queue", which leads to SQS\'s create form', async () => {
    vi.mocked(api.listQueueChoices).mockResolvedValue({ choices: [] });
    const router = open('sqs');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No queues');
    });
    fireEvent.click(screen.getByRole('link', { name: 'Create queue' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sqs/queues/create');
    });
  });

  it('a failed page → "The queues could not be loaded" with "Retry", the choices already shown kept', async () => {
    vi.mocked(api.listQueueChoices)
      .mockResolvedValueOnce({ choices: [queue('alpha')], nextToken: 't-1' })
      .mockRejectedValueOnce(failed('InvalidParameterValue'))
      .mockResolvedValueOnce({ choices: [queue('beta')] });
    open('sqs');
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The queues could not be loaded');
    });
    expect(dropdownText()).toContain('InvalidParameterValue');
    expect(shown()).toEqual(['alpha']);
    const retry = select().findErrorRecoveryButton();
    expect(retry?.getElement().textContent).toBe('Retry');
    retry?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta']);
    });
    expect(vi.mocked(api.listQueueChoices).mock.calls[2]?.[1]).toEqual({ token: 't-1' });
  });

  it('a failed first page → the same words with "Retry", which reads the first page again', async () => {
    vi.mocked(api.listQueueChoices)
      .mockRejectedValueOnce(failed('InternalError'))
      .mockResolvedValueOnce({ choices: [queue('alpha')] });
    open('sqs');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('The queues could not be loaded');
    });
    select().findErrorRecoveryButton()?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha']);
    });
  });
});

describe('the functions', () => {
  it('opened → "Loading functions", then the first page; "Load more" asks with the marker; no filter is sent', async () => {
    let answer: (page: api.FunctionChoicePage) => void = () => undefined;
    vi.mocked(api.listFunctionChoices)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValueOnce({ choices: [fn('three')] });
    open('lambda');
    expect(PAGE.findFormField()?.findLabel()?.getElement().textContent).toBe('Function');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading functions');
    });
    expect(select().findFilteringInput()).toBeNull();
    expect(vi.mocked(api.listFunctionChoices).mock.calls[0]?.[1]).toBeUndefined();
    act(() => {
      answer({ choices: [fn('one'), fn('two')], nextMarker: 'm-1' });
    });
    await waitFor(() => {
      expect(shown()).toEqual(['one', 'two']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(shown()).toEqual(['one', 'two', 'three']);
    });
    expect(vi.mocked(api.listFunctionChoices).mock.calls[1]?.[1]).toBe('m-1');
    expect(api.listQueueChoices).not.toHaveBeenCalled();
    select().selectOptionByValue(fn('two').arn);
    expect(chosen).toEqual({ protocol: 'lambda', ...fn('two') });
  });

  it('none → "No functions" with "Create function", which leads to Lambda\'s create form', async () => {
    vi.mocked(api.listFunctionChoices).mockResolvedValue({ choices: [] });
    const router = open('lambda');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No functions');
    });
    fireEvent.click(screen.getByRole('link', { name: 'Create function' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/lambda/functions/create');
    });
  });

  it('a failed page → "The functions could not be loaded" with "Retry", the choices already shown kept', async () => {
    vi.mocked(api.listFunctionChoices)
      .mockResolvedValueOnce({ choices: [fn('one')], nextMarker: 'm-1' })
      .mockRejectedValueOnce(failed('ServiceException'))
      .mockResolvedValueOnce({ choices: [fn('two')] });
    open('lambda');
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['one']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The functions could not be loaded');
    });
    expect(shown()).toEqual(['one']);
    select().findErrorRecoveryButton()?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['one', 'two']);
    });
    expect(vi.mocked(api.listFunctionChoices).mock.calls[2]?.[1]).toBe('m-1');
  });
});
