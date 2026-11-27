import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { attachVolume, getVolume, listVolumeInstances } from '../volume-api';

vi.mock('../volume-api', async (original) => ({
  ...(await original<typeof import('../volume-api')>()),
  attachVolume: vi.fn(),
  getVolume: vi.fn(),
  listVolumeInstances: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8311';
const zone = 'us-east-1b';
const id = 'vol-1';
const connection: AreaConnection = {
  engineOrigin: endpoint,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9311, endpoint: 'https://127.0.0.1:9311' } },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(getVolume).mockResolvedValue({ found: true, volume: { id, zone, state: 'available', attachments: [] } });
  vi.mocked(listVolumeInstances).mockResolvedValue({
    items: [
      { id: 'i-1', name: 'Worker', state: 'running', type: 't3.micro', devices: ['/dev/sda1', '/dev/sdf'] },
      { id: 'i-2', state: 'stopped', type: 't3.nano', devices: [] },
    ],
  });
});

afterEach(() => vi.unstubAllGlobals());

async function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/aws/ec2/volumes/volume/${id}`]}>
        <AwsArea
          headerSelector="#top-bar"
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
          routeChanges={0}
          connection={connection}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Attach volume' }));
  const dialog = await screen.findByRole('dialog', { name: 'Attach volume' });
  const select = createWrapper(dialog).findSelect();
  if (select === null) throw new Error('Missing instance selector');
  return { dialog: within(dialog), select };
}

describe('attach volume dialog', () => {
  it('reads instances for the volume zone and names the zone if empty', async () => {
    vi.mocked(listVolumeInstances).mockResolvedValue({ items: [] });
    const { dialog, select } = await open();
    expect(listVolumeInstances).not.toHaveBeenCalled();
    act(() => select.openDropdown());
    expect(await dialog.findByText(`No instances in ${zone}`)).toBeVisible();
    expect(listVolumeInstances).toHaveBeenCalledExactlyOnceWith(endpoint, zone, undefined, expect.any(AbortSignal));
  });

  it('keeps Device name editable and shows only the chosen instance’s devices', async () => {
    const { dialog, select } = await open();
    const device = dialog.getByRole('textbox', { name: 'Device name' });
    expect(device).toHaveAccessibleDescription('For example, /dev/sdf.');
    act(() => select.openDropdown());
    await waitFor(() => expect(select.findDropdown().findOptionByValue('i-1')).not.toBeNull());
    act(() => select.selectOptionByValue('i-1'));
    expect(dialog.getByText('In use on i-1: /dev/sda1, /dev/sdf')).toBeVisible();
    act(() => select.openDropdown());
    await waitFor(() => expect(select.findDropdown().findOptionByValue('i-2')).not.toBeNull());
    act(() => select.selectOptionByValue('i-2'));
    expect(dialog.queryByText(/In use on/)).not.toBeInTheDocument();
  });

  it('sends one attachment request and keeps the emulator refusal in the dialog', async () => {
    vi.mocked(attachVolume).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'AttachVolume',
        code: 'InvalidParameterValue',
        message: 'Device is in use.',
      }),
    );
    const { dialog, select } = await open();
    act(() => select.openDropdown());
    await waitFor(() => expect(select.findDropdown().findOptionByValue('i-1')).not.toBeNull());
    act(() => select.selectOptionByValue('i-1'));
    const device = dialog.getByRole('textbox', { name: 'Device name' });
    fireEvent.change(device, { target: { value: '/dev/sdf' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Attach volume' }));
    expect(await dialog.findByText(/InvalidParameterValue: Device is in use/)).toBeVisible();
    expect(attachVolume).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      id,
      { instanceId: 'i-1', device: '/dev/sdf' },
      expect.any(AbortSignal),
    );
    expect(device).toHaveValue('/dev/sdf');
  });
});
