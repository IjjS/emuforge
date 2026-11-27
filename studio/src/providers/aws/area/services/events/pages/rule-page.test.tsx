import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { PageResourcesContext } from '../../../components/page-resources';
import { getRule, listRuleTargets, type RuleRead } from '../rule-api';
import { RulePage } from './rule-page';

vi.mock('../rule-api', async (original) => ({
  ...(await original<typeof import('../rule-api')>()),
  getRule: vi.fn(),
  listRuleTargets: vi.fn(),
}));

const operation = 'DescribeRule';
const engineOrigin = 'http://127.0.0.1:8314';
const arn = 'arn:aws:events:us-east-1:000000000000:rule/../.';
const found = { kind: 'found', rule: { Arn: arn, Description: 'Routes orders' } } satisfies RuleRead;
const read = vi.mocked(getRule);
const readTargets = vi.mocked(listRuleTargets);

beforeEach(() => {
  read.mockReset();
  readTargets.mockReset().mockResolvedValue([]);
});

function open() {
  const resources = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <RulePage connection={{ engineOrigin }} params={{ bus: '*..', rule: '*.' }} />
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { page: createWrapper(container), resources };
}

it('uses the address to read the rule before reading its targets', async () => {
  const answer = Promise.withResolvers<RuleRead>();
  read.mockReturnValueOnce(answer.promise);
  const { page, resources } = open();
  expect(page.findHeader()?.findHeadingText().getElement().textContent).toBe('.');
  expect(resources).toHaveBeenCalledWith({ word: 'targets' });
  await waitFor(() => expect(read).toHaveBeenCalledWith(engineOrigin, '..', '.', expect.any(AbortSignal)));
  expect(readTargets).not.toHaveBeenCalled();
  expect(page.findStatusIndicator()?.getElement().textContent).toBe('Loading rule');

  answer.resolve(found);
  await waitFor(() => expect(readTargets).toHaveBeenCalledWith(engineOrigin, '..', '.', expect.any(AbortSignal)));
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent(/^No targets$/));
});

it.each(['Rule . does not exist on EventBus ...', 'Event bus .. does not exist.'])(
  'shows Rule not found for "%s" and skips the targets read',
  async (message) => {
    read.mockResolvedValueOnce({ kind: 'not-found', message });
    const { page } = open();
    const state = page.findContainer()?.getElement();
    await waitFor(() => expect(state).toHaveTextContent('Rule not found'));
    expect(state).toHaveTextContent(message);
    const back = page.findContainer()?.findButton()?.getElement();
    expect(back).toHaveAccessibleName('Go to Rules');
    expect(back).toHaveAttribute('href', '/aws/events/rules');
    expect(readTargets).not.toHaveBeenCalled();
  },
);

it.each([
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Policy denied' }, 'Access denied', 'Policy denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${engineOrigin} did not answer`, ''],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Read refused' },
    'The rule could not be read',
    'Read refused',
  ],
] satisfies [RequestFailure, string, string][])(
  'shows the rule failure %j and retries the rule',
  async (failure, status, detail) => {
    read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(found);
    const { page } = open();
    await waitFor(() => expect(page.findStatusIndicator()?.getElement().textContent).toBe(status));
    if (detail) expect(page.findContainer()?.getElement()).toHaveTextContent(detail);
    expect(readTargets).not.toHaveBeenCalled();
    const retry = page.findContainer()?.findButton()?.getElement();
    expect(retry).toHaveAccessibleName('Retry');
    if (retry) fireEvent.click(retry);
    await waitFor(() => expect(readTargets).toHaveBeenCalledOnce());
    expect(read).toHaveBeenCalledTimes(2);
  },
);

it('keeps the rule details visible when only the targets read fails', async () => {
  read.mockResolvedValueOnce(found);
  readTargets.mockRejectedValueOnce(
    new RequestError({
      kind: 'access-denied',
      operation: 'ListTargetsByRule',
      message: 'Targets refused',
    }),
  );
  const { page } = open();
  await waitFor(() =>
    expect(page.findTable()?.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe('Access denied'),
  );
  expect(page.findContainer()?.findKeyValuePairs()?.findItems()[0]?.findValue()?.getElement().textContent).toBe(arn);
  expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent(
    'ListTargetsByRule was refused: Targets refused',
  );
});
