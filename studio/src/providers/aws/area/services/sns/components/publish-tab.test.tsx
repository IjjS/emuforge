import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import * as api from '../api';
import { EMPTY_FORM, type PublishForm, type PublishResult } from '../publish-form';
import { PublishTab } from './publish-tab';

// The "Publish" tab alone, its form and result held by a stand-in of the topic's page as `topic-page.tsx` holds them,
// with the calls of `api.ts` answered by the case (`api.test.ts` proves the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, publish: vi.fn(), listSubscriptions: vi.fn() };
});

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const FIFO_ARN = 'arn:aws:sns:us-east-1:000000000000:jobs.fifo';
const ENGINE = 'http://127.0.0.1:8309';
const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connection: AreaConnection = {
  result: { kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR } as CheckResult,
  engineOrigin: ENGINE,
};

const ONE_SUBSCRIPTION: api.SubscriptionPage = {
  subscriptions: [
    {
      protocol: 'sqs',
      endpoint: 'arn:aws:sqs:us-east-1:000000000000:inbox',
      arn: `${ARN}:1`,
      pending: false,
    },
  ],
};

let router: ReturnType<typeof createMemoryRouter>;
const where = () => router.state.location.pathname + router.state.location.search;

interface Topic {
  arn?: string;
  fifo?: boolean;
  contentBasedDeduplication?: boolean;
  form?: PublishForm;
}

function Page({ topic }: { topic: Topic }) {
  const [form, setForm] = useState<PublishForm>(topic.form ?? EMPTY_FORM);
  const [result, setResult] = useState<PublishResult | undefined>(undefined);
  return (
    <PublishTab
      topicArn={topic.arn ?? ARN}
      fifo={topic.fifo ?? false}
      contentBasedDeduplication={topic.contentBasedDeduplication ?? false}
      connection={connection}
      form={form}
      onFormChange={setForm}
      result={result}
      onResultChange={setResult}
    />
  );
}

function open(topic: Topic = {}) {
  const path = `/aws/sns/topics/topic/${encodeURIComponent(topic.arn ?? ARN)}?tab=publish`;
  router = createMemoryRouter([{ path: '*', element: <Page topic={topic} /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function fieldByLabel(label: string) {
  return PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
}

function labels(): string[] {
  return PAGE.findAllFormFields().map((each) => text(each.findLabel()?.getElement()));
}

function typeInto(label: string, value: string) {
  const control = fieldByLabel(label)?.getElement().querySelector('textarea, input');
  if (control === null || control === undefined) {
    throw new Error(`no control in ${label}`);
  }
  fireEvent.change(control, { target: { value } });
}

function press() {
  fireEvent.click(screen.getByRole('button', { name: /^Publish(ing)?$/ }));
}

function result(): string {
  const containers = PAGE.findAllContainers();
  const last = containers[containers.length - 1];
  return text(last?.getElement());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSubscriptions).mockResolvedValue(ONE_SUBSCRIPTION);
});

describe('the Publish tab', () => {
  it('a standard topic → message, subject and attributes, no FIFO field', () => {
    open();
    expect(labels()).toEqual(['Message', 'Subject - optional', 'Message attributes - optional']);
    expect(screen.getByText('The text every subscriber receives.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add attribute' })).toBeInTheDocument();
  });

  it('a FIFO topic → both ID fields; with content-based deduplication on, the deduplication one optional with its description', () => {
    open({ arn: FIFO_ARN, fifo: true });
    expect(labels()).toContain('Message group ID');
    expect(labels()).toContain('Message deduplication ID');
    expect(screen.queryByText('Leave empty to deduplicate by the body.')).not.toBeInTheDocument();
  });

  it('a FIFO topic with content-based deduplication → "Message deduplication ID - optional" and its description', () => {
    open({ arn: FIFO_ARN, fifo: true, contentBasedDeduplication: true });
    expect(labels()).toContain('Message group ID');
    expect(labels()).toContain('Message deduplication ID - optional');
    expect(screen.getByText('Leave empty to deduplicate by the body.')).toBeInTheDocument();
  });

  it('before a publish → "Nothing published yet"', () => {
    open();
    expect(result()).toContain('Nothing published yet');
  });

  it('a fault → its message, nothing sent, the focus on the first field at fault', () => {
    open();
    press();
    expect(text(fieldByLabel('Message')?.findError()?.getElement())).toBe('Enter a message.');
    expect(document.activeElement).toBe(fieldByLabel('Message')?.getElement().querySelector('textarea'));
    typeInto('Message', 'hello');
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.change(screen.getByLabelText('Name of attribute 1'), { target: { value: 'color' } });
    fireEvent.change(screen.getByLabelText('Value of attribute 1'), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText('Name of attribute 2'), { target: { value: 'color' } });
    press();
    expect(screen.getByText('This name is already used.')).toBeInTheDocument();
    expect(screen.getByText('Enter a value.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Name of attribute 2'));
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('a FIFO topic without its IDs → both messages at their fields, nothing sent', () => {
    open({ arn: FIFO_ARN, fifo: true });
    typeInto('Message', 'f');
    press();
    expect(text(fieldByLabel('Message group ID')?.findError()?.getElement())).toBe('Enter a message group ID.');
    expect(text(fieldByLabel('Message deduplication ID')?.findError()?.getElement())).toBe(
      'Enter a message deduplication ID.',
    );
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('published → "Published" with the message ID and its copy control, the sentence and the link to the topic', async () => {
    vi.mocked(api.publish).mockResolvedValue({ messageId: 'm-123' });
    open();
    typeInto('Message', 'hello');
    typeInto('Subject - optional', 'Hi');
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.change(screen.getByLabelText('Name of attribute 1'), { target: { value: 'price' } });
    fireEvent.change(screen.getByLabelText('Value of attribute 1'), { target: { value: '12.5' } });
    PAGE.findSelect()?.openDropdown();
    PAGE.findSelect()?.selectOptionByValue('Number');
    press();
    await waitFor(() => {
      expect(result()).toContain('Published');
    });
    expect(vi.mocked(api.publish).mock.calls[0]?.[1]).toEqual({
      topicArn: ARN,
      message: 'hello',
      subject: 'Hi',
      attributes: [{ name: 'price', type: 'Number', value: '12.5' }],
    });
    expect(result()).toContain('Message ID');
    expect(result()).toContain('m-123');
    expect(result()).not.toContain('Sequence number');
    expect(screen.getByRole('button', { name: 'Copy Message ID' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'The emulator accepted the message. A subscription receives it only if the policy of its queue or function allows this topic; Delivery on the Subscriptions tab says which do.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: "See this topic's subscriptions" }));
    await waitFor(() => {
      expect(where()).toBe(`/aws/sns/topics/topic/${encodeURIComponent(ARN)}`);
    });
  });

  it('published to a FIFO topic → the sequence number; the IDs were sent', async () => {
    vi.mocked(api.publish).mockResolvedValue({ messageId: 'm-9', sequenceNumber: '10000000000000000001' });
    open({ arn: FIFO_ARN, fifo: true });
    typeInto('Message', 'f');
    typeInto('Message group ID', 'g1');
    typeInto('Message deduplication ID', 'd1');
    press();
    await waitFor(() => {
      expect(result()).toContain('Sequence number');
    });
    expect(result()).toContain('10000000000000000001');
    expect(vi.mocked(api.publish).mock.calls[0]?.[1]).toEqual({
      topicArn: FIFO_ARN,
      message: 'f',
      groupId: 'g1',
      deduplicationId: 'd1',
    });
  });

  it('published to a topic without subscriptions → the sentence that it has none', async () => {
    vi.mocked(api.listSubscriptions).mockResolvedValue({ subscriptions: [] });
    vi.mocked(api.publish).mockResolvedValue({ messageId: 'm-1' });
    open();
    await waitFor(() => {
      expect(api.listSubscriptions).toHaveBeenCalled();
    });
    typeInto('Message', 'hello');
    press();
    expect(
      await screen.findByText('This topic has no subscriptions, so the message was delivered nowhere.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "See this topic's subscriptions" })).toBeInTheDocument();
  });

  it('published while the subscriptions could not be read → "The emulator accepted the message." alone, with the link', async () => {
    vi.mocked(api.listSubscriptions).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'ListSubscriptionsByTopic', code: 'InternalError' }),
    );
    vi.mocked(api.publish).mockResolvedValue({ messageId: 'm-1' });
    open();
    await waitFor(() => {
      expect(api.listSubscriptions).toHaveBeenCalled();
    });
    typeInto('Message', 'hello');
    press();
    expect(await screen.findByText('The emulator accepted the message.')).toBeInTheDocument();
    expect(result()).not.toContain('Delivery on the Subscriptions tab');
    expect(result()).not.toContain('no subscriptions');
    expect(screen.getByRole('link', { name: "See this topic's subscriptions" })).toBeInTheDocument();
  });

  it('published before the subscriptions are read → "The emulator accepted the message." alone, with the link', async () => {
    vi.mocked(api.listSubscriptions).mockImplementation(() => new Promise<api.SubscriptionPage>(() => undefined));
    vi.mocked(api.publish).mockResolvedValue({ messageId: 'm-1' });
    open();
    typeInto('Message', 'hello');
    press();
    expect(await screen.findByText('The emulator accepted the message.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "See this topic's subscriptions" })).toBeInTheDocument();
  });

  it('refused → "The message was not published" with the code and message; the form is kept', async () => {
    vi.mocked(api.publish).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'Publish',
        code: 'ParameterValueInvalid',
        message: 'Could not cast message attribute n value to number.',
      }),
    );
    open();
    typeInto('Message', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.change(screen.getByLabelText('Name of attribute 1'), { target: { value: 'n' } });
    fireEvent.change(screen.getByLabelText('Value of attribute 1'), { target: { value: 'abc' } });
    press();
    await waitFor(() => {
      expect(result()).toContain('The message was not published');
    });
    expect(result()).toContain('ParameterValueInvalid: Could not cast message attribute n value to number.');
    expect(fieldByLabel('Message')?.getElement().querySelector('textarea')?.value).toBe('x');
    expect((screen.getByLabelText('Name of attribute 1') as HTMLInputElement).value).toBe('n');
    expect((screen.getByLabelText('Value of attribute 1') as HTMLInputElement).value).toBe('abc');
  });

  it('no answer → the same heading with what did not answer; the form is kept', async () => {
    vi.mocked(api.publish).mockRejectedValue(new RequestError({ kind: 'engine-did-not-answer', operation: 'Publish' }));
    open();
    typeInto('Message', 'x');
    press();
    await waitFor(() => {
      expect(result()).toContain('The message was not published');
    });
    expect(result()).toContain(`The EmuForge engine at ${ENGINE} did not answer`);
    expect(fieldByLabel('Message')?.getElement().querySelector('textarea')?.value).toBe('x');
  });

  it('the emulator not answering → the same heading with its words', async () => {
    vi.mocked(api.publish).mockRejectedValue(
      new RequestError({ kind: 'emulator-did-not-answer', operation: 'Publish', message: 'connection refused' }),
    );
    open();
    typeInto('Message', 'x');
    press();
    await waitFor(() => {
      expect(result()).toContain('The message was not published');
    });
    expect(result()).toContain('The emulator did not answer');
    expect(result()).toContain('connection refused');
  });

  it('while publishing, the button reads "Publishing" and a second press sends nothing; the outcome is announced once', async () => {
    let finish: (published: api.Published) => void = () => undefined;
    vi.mocked(api.publish).mockImplementation(
      () =>
        new Promise<api.Published>((resolve) => {
          finish = resolve;
        }),
    );
    open();
    typeInto('Message', 'hello');
    press();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Publishing/ })).toBeInTheDocument();
    });
    press();
    fireEvent.submit(screen.getByRole('button', { name: /Publishing/ }).closest('form') as HTMLFormElement);
    expect(api.publish).toHaveBeenCalledTimes(1);
    const announcer = document.querySelector('.aws-area-announcer');
    expect(text(announcer)).toBe('');
    act(() => {
      finish({ messageId: 'm-1' });
    });
    await waitFor(() => {
      expect(text(announcer)).toBe('Published');
    });
    expect(announcer?.children).toHaveLength(1);
    typeInto('Message', 'hello again');
    expect(text(announcer)).toBe('Published');
    expect(announcer?.children).toHaveLength(1);
  });

  it('a message that holds markup is shown as text in the form and nowhere as markup', async () => {
    const markup = '<img src=x onerror="alert(1)"><b>bold</b>';
    vi.mocked(api.publish).mockResolvedValue({ messageId: '<i>id</i>' });
    open({ form: { ...EMPTY_FORM, message: markup, subject: '<script>s</script>' } });
    expect(fieldByLabel('Message')?.getElement().querySelector('textarea')?.value).toBe(markup);
    press();
    await waitFor(() => {
      expect(result()).toContain('Published');
    });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('i')).toBeNull();
    expect(result()).toContain('<i>id</i>');
  });
});
