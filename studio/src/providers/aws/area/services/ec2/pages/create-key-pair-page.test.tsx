import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../key-pair-api';
import { EC2_KEYS } from '../queries';

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

function KeyPairsObserver() {
  const query = useQuery({
    queryKey: EC2_KEYS.keyPairs('observer'),
    queryFn: ({ signal }) => api.listKeyPairs(ENGINE, signal),
    initialData: [{ name: 'initial' }],
  });
  return <output aria-label="Observed key pairs">{query.data.map(({ name }) => name).join(', ')}</output>;
}

function open(path = '/aws/ec2/key-pairs/create', observe = false) {
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
      {observe && <KeyPairsObserver />}
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

function keyOption(value: string) {
  return createWrapper(document.body)
    .findAllRadioGroups()
    .flatMap((group) => group.findButtons())
    .find((button) => button.findNativeInput().getElement().value === value);
}

function modeInput(value: 'create' | 'import') {
  const input = createWrapper(document.body).findTiles()?.findInputByValue(value)?.getElement();
  if (input === undefined) throw new Error(`Missing key pair mode ${value}`);
  return input;
}

function choose(value: 'create' | 'import' | 'rsa' | 'ed25519' | 'pem' | 'ppk') {
  const input =
    value === 'create' || value === 'import' ? modeInput(value) : keyOption(value)?.findNativeInput().getElement();
  if (input === undefined) throw new Error(`Missing key pair option ${value}`);
  fireEvent.click(input);
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
    expect(modeInput('create')).toBeChecked();
    expect(keyOption('rsa')?.findNativeInput().getElement()).toBeChecked();
    expect(keyOption('pem')?.findNativeInput().getElement()).toBeChecked();
    expect(keyOption('ed25519')?.findNativeInput().getElement()).not.toBeChecked();
    expect(keyOption('ppk')?.findNativeInput().getElement()).not.toBeChecked();
    const page = text(document.body);
    expect(page).toContain('1 to 255 ASCII characters.');
    expect(page).toContain('The emulator makes the key pair and returns the private key once.');
    expect(page).toContain('The emulator stores a public key you already have.');
    expect(keyOption('rsa')?.findDescription()?.getElement().textContent).toBe(
      'The emulator returns an RSA private key.',
    );
    expect(keyOption('ed25519')?.findDescription()?.getElement().textContent).toBe(
      'The emulator returns an ED25519 private key.',
    );
    expect(keyOption('pem')?.findDescription()?.getElement().textContent).toBe('The private key as PEM text.');
    expect(keyOption('ppk')?.findDescription()?.getElement().textContent).toBe("The private key in PuTTY's format.");
    expect(screen.getByRole('heading', { name: 'Tags - optional' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Public key/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create key pair' })).toBeInTheDocument();

    choose('import');
    expect(keyOption('rsa')?.findNativeInput().getElement().value).toBeUndefined();
    expect(keyOption('pem')?.findNativeInput().getElement().value).toBeUndefined();
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
    choose('import');
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
    choose('ed25519');
    choose('ppk');
    submit('Add tag');
    typeInto('Key', 'team');
    typeInto('Value - optional', 'core');
    submit('Create key pair');
    expect(await screen.findByText('Key pair dev created')).toBeInTheDocument();
    expect(vi.mocked(api.createKeyPair).mock.calls[0]?.slice(1, 2)).toEqual([
      { name: 'dev', type: 'ed25519', format: 'ppk', tags: [{ key: 'team', value: 'core' }] },
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

  it('a create whose answer holds no private key → "-" in its place, with no copy or save control', async () => {
    vi.mocked(api.createKeyPair).mockResolvedValue({ name: 'dev', fingerprint: FINGERPRINT });
    open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    typeInto('Name', 'dev');
    submit('Create key pair');
    expect(await screen.findByText('Key pair dev created')).toBeInTheDocument();
    const value = createWrapper(document.body)
      .findAllKeyValuePairs()
      .flatMap((pairs) => pairs.findItems())
      .find((item) => item.findLabel()?.getElement().textContent === 'Private key');
    expect(text(value?.findValue()?.getElement() ?? document.createElement('span'))).toBe('-');
    expect(screen.queryByRole('textbox', { name: 'Private key' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy private key/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save as/ })).toBeNull();
  });

  it('an import → sent with the name and the text; the page leads to the key pairs list with "Imported key pair {name}"', async () => {
    vi.mocked(api.importKeyPair).mockResolvedValue(undefined);
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('import');
    typeInto('Name', 'imp');
    typeInto('Public key', PUBLIC_KEY);
    submit('Import key pair');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    });
    expect(await screen.findByText('Imported key pair imp')).toBeInTheDocument();
    expect(vi.mocked(api.importKeyPair).mock.calls[0]?.slice(1, 3)).toEqual(['imp', PUBLIC_KEY]);
  });

  it('rejects a tag without a key, then sends the completed row in the import request', async () => {
    const original = await vi.importActual<typeof api>('../key-pair-api');
    vi.mocked(api.importKeyPair).mockImplementationOnce(original.importKeyPair);
    const requests: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-token' });
      requests.push(new URLSearchParams(await request.text()));
      return new Response('<ImportKeyPairResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"/>', {
        headers: { 'content-type': 'text/xml' },
      });
    });
    const router = open();
    await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
    choose('import');
    typeInto('Name', 'imp');
    typeInto('Public key', PUBLIC_KEY);
    submit('Add tag');
    typeInto('Value - optional', 'core');
    submit('Import key pair');
    expect(screen.getByText('Enter a key.')).toBeVisible();
    expect(api.importKeyPair).not.toHaveBeenCalled();

    typeInto('Key', 'team');
    submit('Import key pair');
    expect(await screen.findByText('Imported key pair imp')).toBeVisible();
    expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0] ?? [])).toMatchObject({
      Action: 'ImportKeyPair',
      'TagSpecification.1.ResourceType': 'key-pair',
      'TagSpecification.1.Tag.1.Key': 'team',
      'TagSpecification.1.Tag.1.Value': 'core',
    });
  });

  it.each(['earlier first', 'newer first'])(
    'keeps the private key after both list reads settle (%s)',
    async (order) => {
      const earlier = held<api.KeyPair[]>();
      const newer = held<api.KeyPair[]>();
      vi.mocked(api.listKeyPairs).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(newer.promise);
      vi.mocked(api.createKeyPair).mockResolvedValue({ name: 'dev', privateKey: PRIVATE_KEY });
      open(undefined, true);
      await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
      await waitFor(() => expect(api.listKeyPairs).toHaveBeenCalledTimes(1));
      typeInto('Name', 'dev');
      submit('Create key pair');
      expect(await screen.findByText('Key pair dev created')).toBeVisible();
      await waitFor(() => expect(api.listKeyPairs).toHaveBeenCalledTimes(2));

      const settleEarlier = () => act(async () => earlier.resolve([{ name: 'old' }]));
      const settleNewer = () => act(async () => newer.resolve([{ name: 'dev' }]));
      if (order === 'earlier first') {
        await settleEarlier();
        await settleNewer();
      } else {
        await settleNewer();
        await settleEarlier();
      }
      await waitFor(() => expect(screen.getByLabelText('Observed key pairs')).toHaveTextContent('dev'));
      expect(field('Private key')).toHaveValue(PRIVATE_KEY);
    },
  );

  it.each(['earlier first', 'newer first'])(
    'keeps the imported pair and success after both list reads settle (%s)',
    async (order) => {
      const earlier = held<api.KeyPair[]>();
      const newer = held<api.KeyPair[]>();
      vi.mocked(api.listKeyPairs).mockReturnValueOnce(earlier.promise).mockReturnValue(newer.promise);
      vi.mocked(api.importKeyPair).mockResolvedValue(undefined);
      const router = open(undefined, true);
      await screen.findByRole('heading', { level: 1, name: 'Create key pair' });
      await waitFor(() => expect(api.listKeyPairs).toHaveBeenCalledTimes(1));
      choose('import');
      typeInto('Name', 'imp');
      typeInto('Public key', PUBLIC_KEY);
      submit('Import key pair');
      const result = await screen.findByText('Imported key pair imp');
      await waitFor(() => expect(api.listKeyPairs).toHaveBeenCalledTimes(3));
      const settleEarlier = () => act(async () => earlier.resolve([{ name: 'old' }]));
      const settleNewer = () => act(async () => newer.resolve([{ name: 'imp' }]));
      if (order === 'earlier first') {
        await settleEarlier();
        await settleNewer();
      } else {
        await settleNewer();
        await settleEarlier();
      }
      expect(await screen.findByRole('rowheader', { name: 'imp' })).toBeVisible();
      expect(screen.queryByRole('rowheader', { name: 'old' })).not.toBeInTheDocument();
      expect(result).toBeVisible();
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs');
    },
  );

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
    choose('import');
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
    choose('import');
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
    choose('ppk');
    submit('Cancel');
    let dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Discard what you entered?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(keyOption('ppk')?.findNativeInput().getElement()).toBeChecked();
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
    expect(keyOption('rsa')?.findNativeInput().getElement()).toBeChecked();
  });

  it('the page names its resources "key pairs" to the frame', async () => {
    open();
    expect(await screen.findByText('These key pairs are in your local emulator')).toBeInTheDocument();
  });
});
