import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../area-root';
import type { AreaConnection } from '../../components/emulator-line';
import type { Instance } from './api';
import { InstanceUserDataEditor } from './components/instance-user-data-editor';
import { changeInstanceContent, getInstanceUserData, type InstanceUserData } from './instance-content-api';
import { useInstanceContentChange } from './instance-content-queries';

vi.mock('./instance-content-api', async (original) => ({
  ...(await original<typeof import('./instance-content-api')>()),
  changeInstanceContent: vi.fn(),
  getInstanceUserData: vi.fn(),
}));

it('shows the latest saved user data on reopening even when an earlier read resolves last', async () => {
  const endpoint = 'http://127.0.0.1:8364';
  const instance: Instance = { id: 'i-query', state: 'stopped', groups: [], tags: [], volumes: [] };
  const connection: AreaConnection = { engineOrigin: endpoint, result: undefined };
  let resolveOld: (data: InstanceUserData) => void = () => undefined;
  const old = new Promise<InstanceUserData>((resolve) => {
    resolveOld = resolve;
  });
  let current = 'new';
  vi.mocked(changeInstanceContent).mockImplementation(async (_endpoint, _id, change) => {
    if (change.kind === 'user-data') current = change.text;
    await Promise.resolve();
  });
  vi.mocked(getInstanceUserData)
    .mockReturnValueOnce(old)
    .mockImplementation(() => Promise.resolve({ kind: 'text', text: current }));

  const saved = vi.fn();
  function Fixture() {
    const root = useRef<HTMLDivElement>(null);
    const { save } = useInstanceContentChange(endpoint, instance.id);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <button
            onClick={() =>
              void save(
                { kind: 'user-data', text: 'fresh\nvalue' },
                {
                  label: 'Edit user data',
                  result: 'User data updated.',
                  onSettled: saved,
                },
              )
            }
          >
            Save from another editor
          </button>
          <InstanceUserDataEditor instance={instance} connection={connection} />
        </div>
      </AreaRootContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Fixture />
    </QueryClientProvider>,
  );
  const editor = screen.getByRole('button', { name: 'Edit user data' });
  const writer = screen.getByRole('button', { name: 'Save from another editor' });
  fireEvent.click(editor);
  let dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Loading user data')).toBeVisible();
  await waitFor(() => expect(getInstanceUserData).toHaveBeenCalledTimes(1));
  fireEvent.click(writer);
  await waitFor(() => expect(saved).toHaveBeenCalledExactlyOnceWith());
  await waitFor(() => expect(getInstanceUserData).toHaveBeenCalledTimes(2));
  expect(vi.mocked(getInstanceUserData).mock.calls[0]?.[2].aborted).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(editor);
  dialog = await screen.findByRole('dialog');
  const field = () => createWrapper(dialog).findTextarea()?.findNativeTextarea().getElement();
  await waitFor(() => expect(field()).toHaveValue('fresh\nvalue'));
  await act(async () => {
    resolveOld({ kind: 'text', text: 'stale' });
    await old;
  });
  expect(field()).toHaveValue('fresh\nvalue');
});
