import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import * as api from '../api';
import { settingsTabHref } from '../format';
import { TopicPage } from '../pages/topic-page';

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return {
    ...original,
    getTopic: vi.fn(),
    listTopicTags: vi.fn(),
    setTopicSetting: vi.fn(),
    tagTopic: vi.fn(),
    untagTopic: vi.fn(),
  };
});

const ENGINE = 'http://127.0.0.1:8309';
const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const POLICY = '{\n  "Statement": []\n}';
const TAGS = [
  { key: 'color', value: 'red' },
  { key: 'keep', value: 'one' },
];
const topic = (displayName = 'Orders', policy = POLICY): api.TopicRead => ({
  found: true,
  topic: { arn: ARN, displayName, policy, fifo: false, contentBasedDeduplication: false },
});

function TestPage() {
  const root = useRef<HTMLDivElement>(null);
  const [flash, show] = useState<FlashResult>();
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PageFlashContext value={{ show, handOver: () => undefined }}>
          {flash?.map((item, index) => (
            <div role="status" key={index}>
              {item.header}
              {item.content}
            </div>
          ))}
          <TopicPage params={{ arn: ARN }} connection={{ engineOrigin: ENGINE, result: undefined }} />
        </PageFlashContext>
      </AreaRootContext>
    </div>
  );
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[settingsTabHref(ARN)]}>
        <TestPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fail(failure: RequestFailure) {
  return new RequestError(failure);
}

function unavailable(operation: string) {
  return fail({ kind: 'not-implemented', operation });
}

function setField(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
}

async function editAttribute(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${label.toLowerCase()}` }));
  return screen.getByRole('textbox', { name: label });
}

async function editTag() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit tag color' }));
  return screen.getByRole('textbox', { name: 'Value' });
}

async function openRemove() {
  fireEvent.click(await screen.findByRole('button', { name: 'Remove tag color' }));
  return within(await screen.findByRole('dialog', { name: 'Remove tag' }));
}

const colorRow = () => screen.findByRole('row', { name: /color/ });

beforeEach(() => {
  vi.mocked(api.getTopic).mockReset().mockResolvedValue(topic());
  vi.mocked(api.listTopicTags).mockReset().mockResolvedValue(TAGS);
  vi.mocked(api.setTopicSetting).mockReset().mockResolvedValue();
  vi.mocked(api.tagTopic).mockReset().mockResolvedValue();
  vi.mocked(api.untagTopic).mockReset().mockResolvedValue();
});

describe('topic attribute editors', () => {
  it.each([
    { label: 'Display name', value: 'Orders' },
    { label: 'Access policy', value: POLICY },
  ])('cancels $label without writing and shows the original value', async ({ label, value }) => {
    open();
    const field = await editAttribute(label);
    expect(field).toHaveValue(value);
    setField(field, 'Discarded');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: label })).not.toBeInTheDocument();
    const settings = within(screen.getByRole('tabpanel', { name: 'Settings' }));
    expect(settings.getByText(value, { normalizer: (text) => text })).toBeVisible();
    expect(api.setTopicSetting).not.toHaveBeenCalled();
  });

  it('shows the rejected policy and allows editing and resubmitting it', async () => {
    vi.mocked(api.setTopicSetting).mockRejectedValueOnce(
      fail({
        kind: 'other',
        operation: 'SetTopicAttributes',
        code: 'InvalidParameter',
        message: 'Invalid parameter: Policy Error: null',
      }),
    );
    open();
    const field = await editAttribute('Access policy');
    setField(field, 'invalid');
    save();
    expect(await screen.findByText('InvalidParameter')).toBeVisible();
    expect(screen.getByText(/Invalid parameter: Policy Error: null/)).toBeVisible();
    expect(field).toHaveValue('invalid');
    expect(screen.queryByText('Access policy saved.')).not.toBeInTheDocument();
    const corrected = '{\n    "Statement": []\n}';
    vi.mocked(api.getTopic).mockResolvedValue(topic('Orders', corrected));
    setField(field, corrected);
    save();
    expect(await screen.findByText('Access policy saved.')).toBeVisible();
    expect(await screen.findByText(corrected, { normalizer: (text) => text })).toBeVisible();
    expect(api.setTopicSetting).toHaveBeenLastCalledWith(
      ENGINE,
      ARN,
      { name: 'Policy', value: corrected },
      expect.any(AbortSignal),
    );
  });

  it('sends a pending attribute save only once', async () => {
    const write = hold<undefined>();
    vi.mocked(api.setTopicSetting).mockReturnValueOnce(write.promise);
    open();
    const field = await editAttribute('Display name');
    setField(field, '');
    const form = field.closest('form');
    expect(form).not.toBeNull();
    if (form === null) {
      throw new Error('Expected the display name editor to use a form');
    }
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(api.setTopicSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'DisplayName', value: '' },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      write.resolve(undefined);
    });
    expect(await screen.findByText('Display name saved.')).toBeVisible();
  });

  it('shows a SetTopicAttributes 501 and disables edits of both attributes', async () => {
    vi.mocked(api.setTopicSetting).mockRejectedValueOnce(unavailable('SetTopicAttributes'));
    open();
    const field = await editAttribute('Access policy');
    setField(field, 'unsupported');
    save();
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for SetTopicAttributes/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit display name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit access policy' })).toBeDisabled();
  });
});

describe('reading topic tags', () => {
  it('shows loading while the tag read is pending', async () => {
    const tags = hold<api.TopicTag[]>();
    vi.mocked(api.listTopicTags).mockReturnValueOnce(tags.promise);
    open();
    expect(await screen.findByText('Loading tags')).toBeVisible();
    expect(screen.queryByText('No tags')).not.toBeInTheDocument();
    await act(async () => {
      tags.resolve(TAGS);
    });
    expect(await colorRow()).toBeVisible();
  });

  it('shows No tags for a successful empty read', async () => {
    vi.mocked(api.listTopicTags).mockResolvedValue([]);
    open();
    expect(await screen.findByText('No tags')).toBeVisible();
  });

  const readError = fail({
    kind: 'other',
    operation: 'ListTagsForResource',
    code: 'InternalError',
    message: 'Tag store temporarily unavailable',
  });

  it('shows the retryable tag error while topic attributes remain readable', async () => {
    vi.mocked(api.listTopicTags).mockRejectedValueOnce(readError);
    open();
    expect(await screen.findByText('InternalError')).toBeVisible();
    expect(screen.getByText(/Tag store temporarily unavailable/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.getByText(POLICY, { normalizer: (text) => text })).toBeVisible();
    expect(within(screen.getByRole('tabpanel', { name: 'Settings' })).getByText('Orders')).toBeVisible();
    expect(screen.queryByText('No tags')).not.toBeInTheDocument();
  });

  it('shows the returned rows after a successful retry', async () => {
    vi.mocked(api.listTopicTags).mockRejectedValueOnce(readError);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(within(await colorRow()).getByText('red')).toBeVisible();
    expect(api.listTopicTags).toHaveBeenCalledTimes(2);
  });

  it('shows a ListTagsForResource 501 and disables tag actions without Retry', async () => {
    vi.mocked(api.listTopicTags).mockRejectedValueOnce(unavailable('ListTagsForResource'));
    open();
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for ListTagsForResource/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    expect(screen.queryByText('No tags')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it.each([
    {
      failure: { kind: 'access-denied', operation: 'ListTagsForResource', message: 'This topic is restricted' },
      shown: /This topic is restricted/,
      retryable: false,
    },
    {
      failure: { kind: 'engine-did-not-answer', operation: 'ListTagsForResource' },
      shown: /did not answer/,
      retryable: true,
    },
    {
      failure: {
        kind: 'emulator-did-not-answer',
        operation: 'ListTagsForResource',
        message: 'Check that the emulator is running',
      },
      shown: /Check that the emulator is running/,
      retryable: true,
    },
  ] satisfies { failure: RequestFailure; shown: RegExp; retryable: boolean }[])(
    'shows the area recovery state for $failure.kind',
    async ({ failure, shown, retryable }) => {
      vi.mocked(api.listTopicTags).mockRejectedValueOnce(fail(failure));
      open();
      const table = within(await screen.findByRole('table', { name: 'Tags' }));
      expect(await table.findByText(shown)).toBeVisible();
      expect(table.queryByRole('button', { name: 'Retry' }) !== null).toBe(retryable);
    },
  );
});

describe('writing topic tags', () => {
  it('cancels a tag value edit without writing', async () => {
    open();
    const field = await editTag();
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveAttribute('readonly');
    setField(field, 'blue');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(await colorRow()).getByText('red')).toBeVisible();
    expect(api.tagTopic).not.toHaveBeenCalled();
  });

  it('cancels removal and leaves the row without a write', async () => {
    open();
    const dialog = await openRemove();
    setField(dialog.getByRole('textbox'), 'remove');
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(within(await colorRow()).getByText('red')).toBeVisible();
    expect(api.untagTopic).not.toHaveBeenCalled();
  });

  it('names the selected key and removes only that key after confirmation', async () => {
    open();
    const dialog = await openRemove();
    expect(dialog.getByText('color')).toBeVisible();
    const remove = dialog.getByRole('button', { name: 'Remove' });
    expect(remove).toBeDisabled();
    vi.mocked(api.listTopicTags).mockResolvedValue(TAGS.slice(1));
    setField(dialog.getByRole('textbox'), 'remove');
    fireEvent.click(remove);
    expect(api.untagTopic).toHaveBeenCalledExactlyOnceWith(ENGINE, ARN, 'color', expect.any(AbortSignal));
    expect(await screen.findByText('Tag removed.')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /color/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('row', { name: /keep/ })).toBeVisible();
  });

  it('keeps the original row and shows a rejected tag write without a success message', async () => {
    vi.mocked(api.tagTopic).mockRejectedValueOnce(
      fail({
        kind: 'other',
        operation: 'TagResource',
        code: 'InvalidParameter',
        message: 'Tag value rejected',
      }),
    );
    open();
    const field = await editTag();
    setField(field, 'blue');
    save();
    expect(await screen.findByText(/Tag value rejected/)).toBeVisible();
    expect(within(await colorRow()).getByText('red')).toBeVisible();
    expect(screen.queryByText('Tag saved.')).not.toBeInTheDocument();
  });

  const reorderCases = [
    { action: 'remove', first: 'detail' },
    { action: 'remove', first: 'tags' },
    { action: 'save', first: 'detail' },
    { action: 'save', first: 'tags' },
  ];

  it.each(reorderCases)('retains the $action message when $first returns first', async ({ action, first }) => {
    open();
    await colorRow();
    const detail = hold<api.TopicRead>();
    const tags = hold<api.TopicTag[]>();
    vi.mocked(api.getTopic).mockReturnValueOnce(detail.promise);
    vi.mocked(api.listTopicTags).mockReturnValueOnce(tags.promise);
    const adding = action === 'save';
    if (adding) {
      fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
      setField(screen.getByRole('textbox', { name: 'Key' }), 'new-key');
      setField(screen.getByRole('textbox', { name: 'Value' }), 'blue');
      save();
    } else {
      const dialog = await openRemove();
      setField(dialog.getByRole('textbox'), 'remove');
      fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    }
    const success = adding ? 'Tag saved.' : 'Tag removed.';
    expect(await screen.findByText(success)).toBeVisible();
    const finishDetail = async () => {
      await act(async () => {
        detail.resolve(topic('Fresh details'));
      });
      expect(
        await within(screen.getByRole('tabpanel', { name: 'Settings' })).findByText('Fresh details'),
      ).toBeVisible();
    };
    const finishTags = async () => {
      await act(async () => {
        tags.resolve(adding ? [...TAGS, { key: 'new-key', value: 'blue' }] : TAGS.slice(1));
      });
      if (adding) {
        expect(within(await screen.findByRole('row', { name: /new-key/ })).getByText('blue')).toBeVisible();
      } else {
        await waitFor(() => {
          expect(screen.queryByRole('row', { name: /color/ })).not.toBeInTheDocument();
        });
      }
    };
    if (first === 'detail') {
      await finishDetail();
      expect(screen.getByText(success)).toBeVisible();
      await finishTags();
    } else {
      await finishTags();
      expect(screen.getByText(success)).toBeVisible();
      await finishDetail();
    }
    expect(screen.getByText(success)).toBeVisible();
    expect(api.getTopic).toHaveBeenCalledTimes(2);
    expect(api.listTopicTags).toHaveBeenCalledTimes(2);
  });

  it('shows a TagResource 501 and disables adding and editing tags', async () => {
    vi.mocked(api.tagTopic).mockRejectedValueOnce(unavailable('TagResource'));
    open();
    const field = await editTag();
    setField(field, 'blue');
    save();
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for TagResource/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tag color' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove tag color' })).toBeEnabled();
  });

  it('shows an UntagResource 501 and disables removal', async () => {
    vi.mocked(api.untagTopic).mockRejectedValueOnce(unavailable('UntagResource'));
    open();
    const dialog = await openRemove();
    setField(dialog.getByRole('textbox'), 'remove');
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for UntagResource/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove tag color' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tag color' })).toBeEnabled();
  });
});
