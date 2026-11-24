import createWrapper, { type ModalWrapper } from '@cloudscape-design/components/test-utils/dom';
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
          <section aria-label="Page results">
            {flash?.map((item, index) => (
              <div role="status" key={index}>
                <span>{item.header}</span>
                <span>{item.content}</span>
              </div>
            ))}
          </section>
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

const PAGE = createWrapper(document.body);
const settingsContent = () => PAGE.findTabs()?.findTabContent();
const tagsTable = () => settingsContent()?.findTable();
const tagEmptySlot = () => tagsTable()?.findEmptySlot();
const settingsPanel = () => {
  const content = settingsContent();
  if (!content) {
    throw new Error('Missing Settings content');
  }
  return within(content.getElement());
};
const pageResults = () => within(screen.getByRole('region', { name: 'Page results' }));

function tagCell(key: string) {
  const table = tagsTable();
  return table
    ?.findRows()
    .map((_, index) => table.findBodyCell(index + 1, 1))
    .find((cell) => cell && within(cell.getElement()).queryByText(key));
}

const visibleTagCell = (key: string) =>
  waitFor(() => {
    const cell = tagCell(key);
    if (!cell) {
      throw new Error(`Missing tag cell for ${key}`);
    }
    expect(cell.getElement()).toBeVisible();
    return cell;
  });

function expectSettingsAlert(heading: string, detail: string | RegExp) {
  return waitFor(() => {
    const alert = settingsContent()
      ?.findAllAlerts()
      .find((item) => item.findHeader()?.getElement().textContent.trim() === heading);
    expect(alert?.getElement()).toBeVisible();
    expect(alert?.findHeader()?.getElement()).toBeVisible();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent(heading);
    expect(alert?.findContent().getElement()).toBeVisible();
    expect(alert?.findContent().getElement()).toHaveTextContent(detail);
  });
}

const expectUnavailable = (operation: string) =>
  expectSettingsAlert('Not implemented by the emulator', `The emulator answered 501 Not Implemented for ${operation}.`);

async function openRemove() {
  fireEvent.click(await screen.findByRole('button', { name: 'Remove tag color' }));
  return waitFor(() => {
    const modal = PAGE.findModal();
    if (!modal) {
      throw new Error('Missing the tag removal modal');
    }
    expect(modal.getElement()).toBeVisible();
    expect(modal.findHeader().getElement()).toHaveTextContent('Remove tag');
    return modal;
  });
}

function confirmationInput(modal: ModalWrapper) {
  const input = modal.findContent().findInput()?.findNativeInput().getElement();
  if (!input) {
    throw new Error('Missing tag confirmation input');
  }
  return input;
}

function removalButton(modal: ModalWrapper, label: 'Cancel' | 'Remove') {
  const button = modal.findFooter()?.findAllButtons()[label === 'Cancel' ? 0 : 1]?.getElement();
  if (!button) {
    throw new Error(`Missing removal dialog button ${label}`);
  }
  expect(button).toHaveTextContent(label);
  return button;
}

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
    const settings = settingsPanel();
    expect(settings.getByText(value, { normalizer: (text) => text })).toBeVisible();
    expect(settings.getByRole('button', { name: `Edit ${label.toLowerCase()}` })).toHaveFocus();
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
    expect(field).toHaveAccessibleDescription('Enter the access policy as a JSON document.');
    setField(field, 'invalid');
    save();
    expect(await pageResults().findByText('Save access policy failed')).toBeVisible();
    expect(pageResults().getByText(/Invalid parameter: Policy Error: null/)).toBeVisible();
    await expectSettingsAlert('Save access policy failed', /InvalidParameter.*Invalid parameter: Policy Error: null/);
    expect(field).toHaveValue('invalid');
    expect(screen.queryByText('Access policy saved.')).not.toBeInTheDocument();
    const corrected = '{\n    "Statement": []\n}';
    vi.mocked(api.getTopic).mockResolvedValue(topic('Orders', corrected));
    setField(field, corrected);
    save();
    expect(await screen.findByText('Access policy saved.')).toBeVisible();
    expect(await screen.findByText(corrected, { normalizer: (text) => text })).toBeVisible();
    expect(settingsPanel().getByRole('button', { name: 'Edit access policy' })).toHaveFocus();
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
    expect(await pageResults().findByText('Not implemented by the emulator')).toBeVisible();
    await expectUnavailable('SetTopicAttributes');
    expect(screen.getByRole('button', { name: 'Edit display name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit access policy' })).toBeDisabled();
  });
});

describe('reading topic tags', () => {
  it('shows loading while the tag read is pending', async () => {
    const tags = hold<api.TopicTag[]>();
    vi.mocked(api.listTopicTags).mockReturnValueOnce(tags.promise);
    open();
    await waitFor(() => {
      const loading = tagsTable()?.findLoadingText()?.getElement();
      expect(loading).toBeVisible();
      expect(loading).toHaveTextContent('Loading tags');
    });
    expect(tagEmptySlot()?.getElement().textContent ?? '').not.toContain('No tags');
    await act(async () => {
      tags.resolve(TAGS);
    });
    await visibleTagCell('color');
  });

  it('shows No tags for a successful empty read', async () => {
    vi.mocked(api.listTopicTags).mockResolvedValue([]);
    open();
    await waitFor(() => {
      const empty = tagEmptySlot()?.getElement();
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent('No tags');
    });
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
    await waitFor(() => {
      const empty = tagEmptySlot();
      expect(empty?.getElement()).toBeVisible();
      expect(empty?.findStatusIndicator()?.getElement()).toHaveTextContent('could not be read');
      expect(empty?.getElement()).toHaveTextContent('InternalError');
      expect(empty?.getElement()).toHaveTextContent('Tag store temporarily unavailable');
      expect(empty?.findButton()?.getElement()).toBeVisible();
      expect(empty?.findButton()?.getElement()).toHaveTextContent('Retry');
    });
    expect(screen.getByText(POLICY, { normalizer: (text) => text })).toBeVisible();
    expect(settingsPanel().getByText('Orders')).toBeVisible();
    expect(tagEmptySlot()?.getElement().textContent ?? '').not.toContain('No tags');
  });

  it('shows the returned rows after a successful retry', async () => {
    vi.mocked(api.listTopicTags).mockRejectedValueOnce(readError);
    open();
    const retry = await waitFor(() => {
      const button = tagEmptySlot()?.findButton();
      if (!button) {
        throw new Error('Missing the tag read Retry button');
      }
      expect(button.getElement()).toHaveTextContent('Retry');
      return button;
    });
    retry.click();
    expect(within((await visibleTagCell('color')).getElement()).getByText('red')).toBeVisible();
    expect(api.listTopicTags).toHaveBeenCalledTimes(2);
  });

  it('shows a ListTagsForResource 501 and disables tag actions without Retry', async () => {
    vi.mocked(api.listTopicTags).mockRejectedValueOnce(unavailable('ListTagsForResource'));
    open();
    await expectUnavailable('ListTagsForResource');
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    expect(tagEmptySlot()?.getElement().textContent ?? '').not.toContain('No tags');
    expect(tagEmptySlot()?.findButton()).toBeNull();
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
      await waitFor(() => {
        const empty = tagEmptySlot();
        expect(empty?.getElement()).toBeVisible();
        expect(empty?.getElement()).toHaveTextContent(shown);
        const retry = empty?.findButton()?.getElement();
        if (retryable) {
          expect(retry).toBeVisible();
          expect(retry).toHaveTextContent('Retry');
        } else {
          expect(retry).toBeUndefined();
        }
      });
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
    const cell = await visibleTagCell('color');
    expect(within(cell.getElement()).getByText('red')).toBeVisible();
    const edit = cell.findAllButtons()[0]?.getElement();
    expect(edit).toHaveAccessibleName('Edit tag color');
    expect(edit).toHaveFocus();
    expect(api.tagTopic).not.toHaveBeenCalled();
  });

  it('explains existing keys beside Key before submitting an added tag', async () => {
    open();
    await visibleTagCell('color');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const key = screen.getByRole('textbox', { name: 'Key' });
    setField(key, 'color');
    expect(key).toHaveAccessibleDescription(/Saving an existing key replaces its value.*Use Edit in the existing row/);
    expect(api.tagTopic).not.toHaveBeenCalled();
  });

  it('cancels removal and leaves the row without a write', async () => {
    open();
    const dialog = await openRemove();
    setField(confirmationInput(dialog), 'remove');
    fireEvent.click(removalButton(dialog, 'Cancel'));
    expect(within((await visibleTagCell('color')).getElement()).getByText('red')).toBeVisible();
    expect(api.untagTopic).not.toHaveBeenCalled();
  });

  it('names the selected key and removes only that key after confirmation', async () => {
    open();
    const dialog = await openRemove();
    expect(within(dialog.findContent().getElement()).getByText('color')).toBeVisible();
    const remove = removalButton(dialog, 'Remove');
    expect(remove).toBeDisabled();
    vi.mocked(api.listTopicTags).mockResolvedValue(TAGS.slice(1));
    setField(confirmationInput(dialog), 'remove');
    fireEvent.click(remove);
    expect(api.untagTopic).toHaveBeenCalledExactlyOnceWith(ENGINE, ARN, 'color', expect.any(AbortSignal));
    expect(await screen.findByText('Tag removed.')).toBeVisible();
    await waitFor(() => {
      expect(tagCell('color')).toBeUndefined();
    });
    await visibleTagCell('keep');
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
    expect(await pageResults().findByText(/Tag value rejected/)).toBeVisible();
    await expectSettingsAlert('Save tag failed', /InvalidParameter.*Tag value rejected/);
    expect(field).toHaveValue('blue');
    expect(within((await visibleTagCell('color')).getElement()).getByText('red')).toBeVisible();
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
    await visibleTagCell('color');
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
      setField(confirmationInput(dialog), 'remove');
      fireEvent.click(removalButton(dialog, 'Remove'));
    }
    const success = adding ? 'Tag saved.' : 'Tag removed.';
    expect(await screen.findByText(success)).toBeVisible();
    if (adding) {
      expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus();
    }
    const finishDetail = async () => {
      await act(async () => {
        detail.resolve(topic('Fresh details'));
      });
      expect(await settingsPanel().findByText('Fresh details')).toBeVisible();
    };
    const finishTags = async () => {
      await act(async () => {
        tags.resolve(adding ? [...TAGS, { key: 'new-key', value: 'blue' }] : TAGS.slice(1));
      });
      if (adding) {
        expect(within((await visibleTagCell('new-key')).getElement()).getByText('blue')).toBeVisible();
      } else {
        await waitFor(() => {
          expect(tagCell('color')).toBeUndefined();
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
    expect(await pageResults().findByText('Not implemented by the emulator')).toBeVisible();
    await expectUnavailable('TagResource');
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tag color' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove tag color' })).toBeEnabled();
  });

  it('shows an UntagResource 501 and disables removal', async () => {
    vi.mocked(api.untagTopic).mockRejectedValueOnce(unavailable('UntagResource'));
    open();
    const dialog = await openRemove();
    setField(confirmationInput(dialog), 'remove');
    fireEvent.click(removalButton(dialog, 'Remove'));
    expect(await pageResults().findByText('Not implemented by the emulator')).toBeVisible();
    await expectUnavailable('UntagResource');
    expect(screen.getByRole('button', { name: 'Remove tag color' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit tag color' })).toBeEnabled();
  });
});
