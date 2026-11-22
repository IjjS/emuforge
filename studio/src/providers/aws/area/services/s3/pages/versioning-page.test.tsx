import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

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
    if (url.pathname !== `/${BUCKET}`) throw new Error(`Unexpected request path ${url.pathname}`);
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

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

it('shows Disabled when Status is absent and lets the user choose Enable', async () => {
  open();
  expect(screen.getByText('Loading bucket versioning')).toBeVisible();
  const enable = await screen.findByRole('radio', { name: 'Enable' });
  expect(screen.getByText('Disabled')).toBeVisible();
  expect(enable).toBeEnabled();
  expect(saveButton()).toBeDisabled();
  fireEvent.click(enable);
  expect(enable).toBeChecked();
  expect(saveButton()).toBeEnabled();
});

it('returns to Properties on Cancel without saving a selected Suspend', async () => {
  engine.readVersioning = () => versioning('Enabled');
  const router = open();
  expect(await screen.findByRole('radio', { name: 'Enable' })).toBeChecked();
  const suspend = screen.getByRole('radio', { name: 'Suspend' });
  fireEvent.click(suspend);
  expect(suspend).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('tab', { name: 'Properties', selected: true });
  expect(router.state.location.pathname).toBe(PROPERTIES);
  expect(engine.writes).toEqual([]);
});

it('reads the actual status when Retry succeeds after a load failure', async () => {
  engine.readVersioning = () => refusal(400, 'InvalidRequest', 'Versioning could not be read');
  open();
  expect(await screen.findByText('Versioning could not be read', { exact: false })).toBeVisible();
  engine.readVersioning = () => versioning('Suspended');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Suspended')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Suspend' })).toBeChecked();
  expect(engine.reads).toEqual(['versioning', 'versioning']);
});

it('shows the refusal code and message on the editor without reporting success', async () => {
  engine.saveVersioning = () => refusal(403, 'AccessDenied', 'Versioning updates are denied');
  const router = open();
  fireEvent.click(await screen.findByRole('radio', { name: 'Enable' }));
  fireEvent.click(saveButton());
  expect(await screen.findByText('AccessDenied')).toBeVisible();
  expect(screen.getByText('Versioning updates are denied', { exact: false })).toBeVisible();
  expect(screen.queryByText(SUCCESS)).toBeNull();
  expect(router.state.location.pathname).toBe(EDIT);
  expect(engine.writes).toHaveLength(1);
});

it('shows the emulator’s unavailable state for a 501 write', async () => {
  engine.saveVersioning = () => refusal(501, 'NotImplemented', 'Versioning updates are unavailable');
  open();
  fireEvent.click(await screen.findByRole('radio', { name: 'Enable' }));
  fireEvent.click(saveButton());
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/501 Not Implemented for PutBucketVersioning/)).toBeVisible();
  expect(saveButton()).toBeDisabled();
  expect(screen.queryByText(SUCCESS)).toBeNull();
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
  const stateSection = () => screen.getByRole('region', { name: 'Bucket Versioning' });
  await screen.findByText('Disabled');
  fireEvent.click(within(stateSection()).getByRole('link', { name: 'Edit' }));

  fireEvent.click(await screen.findByRole('radio', { name: 'Enable' }));
  engine.saveVersioning = () => heldSave;
  const save = saveButton();
  const form = save.closest('form');
  if (form === null) throw new Error('Save changes must submit the versioning form');
  fireEvent.click(save);
  fireEvent.submit(form);
  await waitFor(() => expect(engine.writes).toHaveLength(1));
  expect(engine.writes[0]).toContain('<Status>Enabled</Status>');
  const priorReads = engine.reads.length;
  engine.readVersioning = () => versioning('Suspended');
  engine.readTags = () => heldTags;
  releaseSave(new Response(null, { status: 204 }));

  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  expect(
    await within(await screen.findByRole('region', { name: 'Bucket Versioning' })).findByText('Suspended'),
  ).toBeVisible();
  expect(engine.reads[priorReads]).toBe('bucket');
  expect(engine.reads.slice(priorReads + 1)).toEqual(expect.arrayContaining(['versioning', 'tags']));
  releaseTags(new Response('<Tagging><TagSet><Tag><Key>team</Key><Value>storage</Value></Tag></TagSet></Tagging>'));
  expect(await screen.findByText('storage')).toBeVisible();
  expect(within(stateSection()).getByText('Suspended')).toBeVisible();
  expect(await screen.findByText(SUCCESS)).toBeVisible();
  expect(engine.writes).toHaveLength(1);
});
