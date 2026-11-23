import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import type { BucketVersioningChange } from '../api';

const BUCKET = 'alpha';
const EDIT = '/aws/s3/bucket/alpha/property/versioning/edit';
const PROPERTIES = '/aws/s3/buckets/alpha/properties';
const SUCCESS = 'Bucket versioning updated.';

function versioning(status?: string) {
  return new Response(
    status === undefined
      ? '<VersioningConfiguration/>'
      : `<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`,
  );
}

function refusal(status: number, code: string, message: string) {
  return new Response(`<Error><Code>${code}</Code><Message>${message}</Message></Error>`, { status });
}

class FakeEngine {
  readVersioning = () => versioning();
  readTags = (): Response | Promise<Response> => new Response('<Tagging><TagSet/></Tagging>');
  saveVersioning = (): Response | Promise<Response> => new Response(null, { status: 204 });
  writes: string[] = [];
  reads: string[] = [];

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') return Response.json({ token: 'versioning-test' });
    if (url.searchParams.get('x-id') === 'ListBuckets') {
      this.reads.push('bucket');
      return new Response(
        `<ListAllMyBucketsResult><Buckets><Bucket><Name>${BUCKET}</Name></Bucket></Buckets></ListAllMyBucketsResult>`,
      );
    }
    if (url.pathname !== `/${BUCKET}` && url.pathname !== `/${BUCKET}/`) {
      throw new Error(`Unexpected request path ${url.pathname}`);
    }
    if (url.searchParams.has('versioning')) {
      if (request.method === 'PUT') {
        this.writes.push(await request.text());
        return this.saveVersioning();
      }
      this.reads.push('versioning');
      return this.readVersioning();
    }
    if (url.searchParams.has('tagging')) {
      this.reads.push('tags');
      return this.readTags();
    }
    if (url.searchParams.has('encryption')) {
      return refusal(404, 'ServerSideEncryptionConfigurationNotFoundError', 'No encryption configuration');
    }
    if (url.searchParams.has('notification')) return new Response('<NotificationConfiguration/>');
    if (url.searchParams.has('website')) return refusal(404, 'NoSuchWebsiteConfiguration', 'No website configuration');
    throw new Error(`Unexpected request ${url.pathname}${url.search}`);
  };
}

let engine: FakeEngine;
let nextPort = 8910;
let connection: AreaConnection;

function Area() {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ pathname, changes: 0 });
  const changes = visit.pathname === pathname ? visit.changes : visit.changes + 1;
  if (visit.pathname !== pathname) setVisit({ pathname, changes });
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      connection={connection}
      routeChanges={changes}
      targetGeneration={0}
    />
  );
}

function open(path = EDIT) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  engine = new FakeEngine();
  connection = {
    engineOrigin: engineEndpoint(++nextPort),
    result: { kind: 'connected', checkedAt: 0, emulator: { port: 9309, endpoint: 'https://127.0.0.1:9309' } },
  };
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => vi.unstubAllGlobals());

const page = () => createWrapper(screen.getByRole('main'));
const form = () => page().findForm();
const statusDescription = () => form()?.findFormField()?.findDescription()?.getElement();
const successFlash = () => page().findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement();

function button(label: string) {
  const found = page()
    .findAllButtons()
    .find((control) => control.findTextRegion()?.getElement().textContent === label);
  if (found === undefined) throw new Error(`Could not find the "${label}" button`);
  return found.getElement();
}

function statusOption(value: BucketVersioningChange, label: string) {
  return waitFor(() => {
    const group = form()?.findRadioGroup();
    const option = group?.findInputByValue(value)?.getElement();
    if (option === undefined) throw new Error(`Could not find versioning option ${value}`);
    const radio = group?.findButtons().find((candidate) => candidate.findNativeInput().getElement() === option);
    expect(radio?.findLabel().getElement()).toHaveTextContent(label);
    return option;
  });
}

const readState = (label: string) =>
  page()
    .findAllContainers()
    .find((container) => container.findStatusIndicator()?.getElement().textContent === label);

it('shows Disabled when Status is absent and lets the user choose Enable', async () => {
  open();
  expect(readState('Loading bucket versioning')?.getElement()).toBeVisible();
  const enable = await statusOption('Enabled', 'Enable');
  expect(statusDescription()).toHaveTextContent('Current status: Disabled');
  expect(enable).toBeEnabled();
  expect(button('Save changes')).toBeDisabled();
  fireEvent.click(enable);
  expect(enable).toBeChecked();
  expect(button('Save changes')).toBeEnabled();
});

it('returns to Properties on Cancel without saving a selected Suspend', async () => {
  engine.readVersioning = () => versioning('Enabled');
  const router = open();
  expect(await statusOption('Enabled', 'Enable')).toBeChecked();
  const suspend = await statusOption('Suspended', 'Suspend');
  fireEvent.click(suspend);
  expect(suspend).toBeChecked();
  fireEvent.click(button('Cancel'));
  await waitFor(() => expect(page().findTabs()?.findActiveTab()?.getElement()).toHaveTextContent('Properties'));
  expect(router.state.location.pathname).toBe(PROPERTIES);
  expect(engine.writes).toEqual([]);
});

it.each([
  [400, 'InvalidRequest', 'Versioning could not be read', 'Bucket versioning could not be read'],
  [403, 'AccessDenied', 'Versioning reads are denied', 'Access denied'],
  [404, 'NoSuchBucket', 'The specified bucket does not exist', 'Bucket not found'],
  [501, 'ReadNotImplemented', 'Versioning reads are unavailable', 'Not implemented by the emulator'],
])('preserves the %s read refusal before reading the actual status on Retry', async (status, code, message, label) => {
  engine.readVersioning = () => refusal(status, code, message);
  open();
  await waitFor(() => {
    const state = readState(label)?.findContent().getElement();
    expect(state).toBeVisible();
    expect(state).toHaveTextContent(`${code}: ${message}`);
    if (status === 501) expect(state).toHaveTextContent('501 Not Implemented for GetBucketVersioning');
  });
  expect(form()).toBeNull();
  engine.readVersioning = () => versioning('Suspended');
  fireEvent.click(button('Retry'));
  expect(await statusOption('Suspended', 'Suspend')).toBeChecked();
  expect(statusDescription()).toHaveTextContent('Current status: Suspended');
  expect(engine.reads).toEqual(['versioning', 'versioning']);
});

it('shows the refusal code and message on the editor without reporting success', async () => {
  engine.saveVersioning = () => refusal(403, 'AccessDenied', 'Versioning updates are denied');
  const router = open();
  fireEvent.click(await statusOption('Enabled', 'Enable'));
  fireEvent.click(button('Save changes'));
  await waitFor(() => {
    const error = form()?.findError()?.getElement();
    expect(error).toBeVisible();
    expect(error).toHaveTextContent('AccessDenied');
    expect(error).toHaveTextContent('Versioning updates are denied');
  });
  expect(successFlash()).toBeUndefined();
  expect(router.state.location.pathname).toBe(EDIT);
  expect(engine.writes).toHaveLength(1);
});

it('shows the emulator’s unavailable state and refusal details for a 501 write', async () => {
  engine.saveVersioning = () => refusal(501, 'WriteNotImplemented', 'Versioning updates are unavailable');
  open();
  fireEvent.click(await statusOption('Enabled', 'Enable'));
  fireEvent.click(button('Save changes'));
  await waitFor(() => {
    const unavailable = form()
      ?.findAllAlerts()
      .find((alert) => alert.findHeader()?.getElement().textContent === 'Not implemented by the emulator');
    expect(unavailable?.getElement()).toBeVisible();
    const content = unavailable?.findContent().getElement();
    expect(content).toHaveTextContent('501 Not Implemented for PutBucketVersioning');
    expect(content).toHaveTextContent('WriteNotImplemented: Versioning updates are unavailable');
  });
  expect(button('Save changes')).toBeDisabled();
  expect(successFlash()).toBeUndefined();
});

it('keeps the success message and the state read from Properties after the parallel reads finish', async () => {
  let releaseSave: (response: Response) => void = () => undefined;
  const heldSave = new Promise<Response>((resolve) => {
    releaseSave = resolve;
  });
  let releaseTags: (response: Response) => void = () => undefined;
  const heldTags = new Promise<Response>((resolve) => {
    releaseTags = resolve;
  });
  const router = open(PROPERTIES);
  const versioningSection = () =>
    page()
      .findAllContainers()
      .find(
        (container) =>
          container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Bucket Versioning',
      );
  const versioningContent = () => versioningSection()?.findContent().getElement();
  await waitFor(() => expect(versioningContent()).toHaveTextContent('Disabled'));
  const edit = versioningSection()?.findHeader()?.findHeader()?.findActions()?.findButton()?.getElement();
  if (edit === undefined) throw new Error('Properties must link to versioning edit');
  expect(edit).toHaveTextContent('Edit');
  expect(edit).toHaveAttribute('href', EDIT);
  fireEvent.click(edit);

  fireEvent.click(await statusOption('Enabled', 'Enable'));
  engine.saveVersioning = () => heldSave;
  const save = button('Save changes');
  const nativeForm = save.form;
  if (nativeForm === null) throw new Error('Save changes must submit the versioning form');
  fireEvent.click(save);
  fireEvent.submit(nativeForm);
  await waitFor(() => expect(engine.writes).toHaveLength(1));
  expect(engine.writes[0]).toContain('<Status>Enabled</Status>');
  const priorReads = engine.reads.length;
  engine.readVersioning = () => versioning('Suspended');
  engine.readTags = () => heldTags;
  releaseSave(new Response(null, { status: 204 }));

  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  await waitFor(() => expect(versioningContent()).toHaveTextContent('Suspended'));
  expect(engine.reads[priorReads]).toBe('bucket');
  expect(engine.reads.slice(priorReads + 1)).toEqual(expect.arrayContaining(['versioning', 'tags']));
  releaseTags(new Response('<Tagging><TagSet><Tag><Key>team</Key><Value>storage</Value></Tag></TagSet></Tagging>'));
  await waitFor(() => {
    const tags = page()
      .findAllTables()
      .find((table) => table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags');
    expect(tags?.findBodyCell(1, 2)?.getElement()).toHaveTextContent('storage');
  });
  expect(versioningContent()).toHaveTextContent('Suspended');
  expect(successFlash()).toHaveTextContent(SUCCESS);
  expect(engine.writes).toHaveLength(1);
});
