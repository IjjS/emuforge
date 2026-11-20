import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../key-pair-api';

// S9 rendered inside the area's layout, with the calls of `key-pair-api.ts` answered by the case
// (`key-pair-api.test.ts` proves the calls against a fake engine).

vi.mock('../key-pair-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../key-pair-api')>();
  return {
    ...real,
    listKeyPairs: vi.fn(),
    createKeyPair: vi.fn(),
    importKeyPair: vi.fn(),
    deleteKeyPair: vi.fn(),
  };
});

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;
}

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
let connection: Connection;
const ENGINE = 'http://127.0.0.1:8309';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/ec2/key-pairs/create') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------

const PRIVATE_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEsecret\n-----END OPENSSH PRIVATE KEY-----\n';
const FINGERPRINT = 'SHA256:abcdEFGH1234';
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOm4 dev@example';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: label });
}

function typeInto(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

function choose(name: string) {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${name.replace('.', '\\.')}`) }));
}

function submit(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** The message the form field labelled `label` shows. */
function fieldText(label: string): string {
  const found = createWrapper(document.body)
    .findAllFormFields()
    .find((formField) => formField.findLabel()?.getElement().textContent === label);
  return text(found?.findError()?.getElement() ?? document.createElement('span'));
}

function held<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(api.listKeyPairs).mockResolvedValue([]);
});

describe('"Create key pair"', () => {
  it('opens on "Create a new key pair" with "RSA", ".pem", the name\'s rule and the two descriptions; "Import a public key" swaps type and format for "Public key"', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Create key pair' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Create a new key pair/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'RSA' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '.pem' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'ED25519' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '.ppk' })).not.toBeChecked();
    const page = text(document.body);
    expect(page).toContain('1 to 255 ASCII characters.');
    expect(page).toContain('The emulator makes the key pair and returns the private key once.');
    expect(page).toContain('The emulator stores a public key you already have.');
    expect(screen.queryByRole('textbox', { name: /Public key/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create key pair' })).toBeInTheDocument();

    choose('Import a public key');
    expect(screen.queryByRole('radio', { name: 'RSA' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '.pem' })).toBeNull();
    expect(field('Public key')).toBeInTheDocument();
    expect(text(document.body)).toContain('In OpenSSH format, as in a .pub file.');
    expect(screen.getByRole('button', { name: 'Import key pair' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create key pair' })).toBeNull();
  });

  it('a fault → its message at the field and nothing sent', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    submit('Create key pair');
    await waitFor(() => {
      expect(fieldText('Name')).toContain('Enter a name.');
    });
    typeInto('Name', 'clé');
    expect(fieldText('Name')).toContain('A name can hold ASCII characters only.');
    typeInto('Name', 'a'.repeat(256));
    expect(fieldText('Name')).toContain('A name can have up to 255 characters.');
    typeInto('Name', 'imp');
    choose('Import a public key');
    submit('Import key pair');
    await waitFor(() => {
      expect(fieldText('Public key')).toContain('Enter a public key.');
    });
    expect(vi.mocked(api.createKeyPair)).not.toHaveBeenCalled();
    expect(vi.mocked(api.importKeyPair)).not.toHaveBeenCalled();
  });

  it('a create with ED25519 and ".ppk" → sent so; the page stays and shows the key once, its file, the fingerprint and "View key pairs"; the form and "Cancel" are gone', async () => {
    vi.mocked(api.createKeyPair).mockResolvedValue({
      name: 'dev',
      privateKey: PRIVATE_KEY,
      fingerprint: FINGERPRINT,
      id: 'key-0dev',
    });
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    typeInto('Name', 'dev');
    choose('ED25519');
    choose('.ppk');
    submit('Create key pair');
    expect(await screen.findByText('Key pair dev created')).toBeInTheDocument();
    expect(vi.mocked(api.createKeyPair).mock.calls[0]?.slice(1, 2)).toEqual([
      { name: 'dev', type: 'ed25519', format: 'ppk' },
    ]);
    expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs/create');
    const page = text(document.body);
    expect(page).toContain(
      'This is the only time the private key is shown. EmuForge Studio does not keep it: copy or save it before you leave this page.',
    );
    expect((field('Private key') as unknown as HTMLTextAreaElement).value).toBe(PRIVATE_KEY);
    expect(screen.getByRole('button', { name: 'Save as dev.ppk' })).toBeInTheDocument();
    expect(page).toContain('Fingerprint');
    expect(page).toContain(FINGERPRINT);
    expect(screen.getByRole('link', { name: 'View key pairs' })).toHaveAttribute('href', '/aws/ec2/key-pairs');
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create key pair' })).toBeNull();
  });

  it('an import → sent with the name and the text; the page leads to the key pairs list with "Imported key pair {name}"', async () => {
    vi.mocked(api.importKeyPair).mockResolvedValue(undefined);
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('Import a public key');
    typeInto('Name', 'imp');
    typeInto('Public key', PUBLIC_KEY);
    submit('Import key pair');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    });
    expect(await screen.findByText('Imported key pair imp')).toBeInTheDocument();
    expect(vi.mocked(api.importKeyPair).mock.calls[0]?.slice(1, 3)).toEqual(['imp', PUBLIC_KEY]);
  });

  it('a refusal → the form stays with the code and message and what was entered', async () => {
    vi.mocked(api.createKeyPair).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'CreateKeyPair',
        code: 'InvalidKeyPair.Duplicate',
        message: 'The keypair already exists',
      }),
    );
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    typeInto('Name', 'dev');
    submit('Create key pair');
    await waitFor(() => {
      expect(text(document.body)).toMatch(/InvalidKeyPair\.Duplicate.*The keypair already exists/);
    });
    expect(field('Name').value).toBe('dev');
    expect(screen.getByRole('button', { name: 'Create key pair' })).toBeInTheDocument();
  });

  it('a 501 → "not implemented by the emulator" with the operation\'s name', async () => {
    vi.mocked(api.importKeyPair).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'ImportKeyPair' }),
    );
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('Import a public key');
    typeInto('Name', 'imp');
    typeInto('Public key', PUBLIC_KEY);
    submit('Import key pair');
    await waitFor(() => {
      expect(text(document.body)).toMatch(/Not implemented by the emulator.*ImportKeyPair/);
    });
  });

  it('while sending, the button reads "Creating" (or "Importing") and a second press sends nothing', async () => {
    const creating = held<api.CreatedKeyPair>();
    vi.mocked(api.createKeyPair).mockReturnValue(creating.promise);
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    typeInto('Name', 'dev');
    submit('Create key pair');
    const busy = await screen.findByRole('button', { name: /Creating/ });
    fireEvent.click(busy);
    fireEvent.submit(busy.closest('form') as HTMLFormElement);
    expect(vi.mocked(api.createKeyPair)).toHaveBeenCalledTimes(1);
    creating.resolve({ name: 'dev', privateKey: PRIVATE_KEY });
    expect(await screen.findByText('Key pair dev created')).toBeInTheDocument();
  });

  it('while importing, the button reads "Importing" and a second press sends nothing', async () => {
    vi.mocked(api.importKeyPair).mockReturnValue(new Promise(() => undefined));
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('Import a public key');
    typeInto('Name', 'imp');
    typeInto('Public key', PUBLIC_KEY);
    submit('Import key pair');
    const busy = await screen.findByRole('button', { name: /Importing/ });
    fireEvent.submit(busy.closest('form') as HTMLFormElement);
    expect(vi.mocked(api.importKeyPair)).toHaveBeenCalledTimes(1);
  });

  it('"Cancel" with nothing entered → the key pairs list at once', async () => {
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    submit('Cancel');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    });
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('.ppk');
    submit('Cancel');
    let dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Discard what you entered?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('radio', { name: '.ppk' })).toBeChecked();
    expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs/create');
    submit('Cancel');
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    });
  });

  it('after a create, the page left and opened again → the empty form and no private key', async () => {
    vi.mocked(api.createKeyPair).mockResolvedValue({ name: 'dev', privateKey: PRIVATE_KEY, fingerprint: FINGERPRINT });
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    typeInto('Name', 'dev');
    submit('Create key pair');
    expect(await screen.findByText('Key pair dev created')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'View key pairs' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    });
    expect(text(document.body)).not.toContain('b3BlbnNzaC1rZXktdjEsecret');
    await router.navigate('/aws/ec2/key-pairs/create');
    await waitFor(() => {
      expect(field('Name').value).toBe('');
    });
    expect(screen.queryByText('Key pair dev created')).toBeNull();
    expect(text(document.body)).not.toContain('b3BlbnNzaC1rZXktdjEsecret');
    expect(document.body.innerHTML).not.toContain('b3BlbnNzaC1rZXktdjEsecret');
    expect(screen.getByRole('radio', { name: 'RSA' })).toBeChecked();
  });

  it('the page names its resources "key pairs" to the frame', async () => {
    open();
    expect(await screen.findByText('These key pairs are in your local emulator')).toBeInTheDocument();
  });
});
