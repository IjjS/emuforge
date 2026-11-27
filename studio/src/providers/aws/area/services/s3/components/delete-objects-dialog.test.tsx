import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import { AreaRootContext } from '../../../area-root';
import type { DeletionSelection } from './object-deletion';
import { DeleteObjectsDialog } from './delete-objects-dialog';

// The delete dialog of the tab "Objects" and the object page (test-criteria.md, issue 480, "Unit s2 —
// services/s3/components/delete-objects-dialog.test.tsx"), inside the area's root, against a fake engine.

interface Answer {
  status: number;
  body: string;
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ok = (body: string): Answer => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xml(message)}</Message></Error>`,
  };
}

interface Seen {
  method: string;
  url: URL;
  body: string;
}

class FakeEngine {
  keys: string[] = [];
  versioning: string | undefined;
  /** The answer of GetBucketVersioning, instead of the one `versioning` makes. */
  versioningAnswer: (() => Answer | Promise<Answer>) | undefined;
  /** Keys `DeleteObjects` refuses, with their message. */
  refuse = new Map<string, string>();
  /** The answer of the n-th `DeleteObjects` (from 0), instead of the emulator's. */
  deleteAnswer: ((call: number) => Answer | Promise<Answer> | undefined) | undefined;
  readonly seen: Seen[] = [];

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'token-1' }), { status: 200 });
    }
    const body = request.method === 'POST' ? await request.text() : '';
    this.seen.push({ method: request.method, url, body });
    const answer = await this.answer(request.method, url, body);
    return new Response(answer.body, { status: answer.status });
  };

  private async answer(method: string, url: URL, body: string): Promise<Answer> {
    if (url.searchParams.has('versioning')) {
      if (this.versioningAnswer !== undefined) return this.versioningAnswer();
      return ok(
        this.versioning === undefined
          ? '<VersioningConfiguration/>'
          : `<VersioningConfiguration><Status>${this.versioning}</Status></VersioningConfiguration>`,
      );
    }
    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const size = Number(url.searchParams.get('max-keys') ?? '1000');
      const start = Number(url.searchParams.get('continuation-token') ?? '0');
      const under = this.keys.filter((key) => key.startsWith(prefix)).sort();
      const page = under.slice(start, start + size);
      const truncated = start + size < under.length;
      return ok(
        `<ListBucketResult><IsTruncated>${String(truncated)}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${String(start + size)}</NextContinuationToken>` : '') +
          page.map((key) => `<Contents><Key>${xml(key)}</Key><Size>1</Size></Contents>`).join('') +
          '</ListBucketResult>',
      );
    }
    if (method === 'POST' && url.searchParams.has('delete')) {
      const call = this.deletes.length - 1;
      const own = await this.deleteAnswer?.(call);
      if (own !== undefined) return own;
      const keys = deleteKeysOf(body);
      const deleted = keys.filter((key) => !this.refuse.has(key));
      this.keys = this.keys.filter((key) => !deleted.includes(key));
      return ok(
        '<DeleteResult>' +
          deleted.map((key) => `<Deleted><Key>${xml(key)}</Key></Deleted>`).join('') +
          keys
            .filter((key) => this.refuse.has(key))
            .map(
              (key) =>
                `<Error><Key>${xml(key)}</Key><Code>AccessDenied</Code><Message>${xml(
                  this.refuse.get(key) ?? '',
                )}</Message></Error>`,
            )
            .join('') +
          '</DeleteResult>',
      );
    }
    return errorAnswer(400, 'InvalidRequest', `not in this fake: ${method} ${url.href}`);
  }

  get deletes(): Seen[] {
    return this.seen.filter((seen) => seen.method === 'POST' && seen.url.searchParams.has('delete'));
  }

  get lists(): Seen[] {
    return this.seen.filter((seen) => seen.url.searchParams.get('list-type') === '2');
  }
}

function deleteKeysOf(body: string): string[] {
  return [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) =>
    (match[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );
}

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9600;
let results: FlashResult[];
let handedOver: string[];
let closes: boolean[];

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  results = [];
  handedOver = [];
  closes = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface HarnessProps {
  selection: DeletionSelection;
  /** Wait for GetBucketVersioning's answer before returning (the default). */
  settle?: boolean;
  single?: string;
  after?: string;
}

/** "Delete" that opens the dialog inside the area's root, and the area's flash as the last result shown. */
function Harness({ selection, single, after }: HarnessProps) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<FlashResult>();
  const flash = useMemo<PageFlash>(
    () => ({
      show: (result) => {
        results.push(result);
        setShown(result);
      },
      handOver: (to, result) => {
        handedOver.push(to);
        results.push(result);
        setShown(result);
      },
    }),
    [],
  );
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PageFlashContext value={flash}>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Open
          </button>
          <div data-testid="flash">
            {shown?.map((item, index) => (
              <div key={index}>
                {item.header}
                {item.content}
              </div>
            ))}
          </div>
          <DeleteObjectsDialog
            visible={open}
            endpoint={endpoint}
            bucket="alpha"
            selection={selection}
            {...(single === undefined ? {} : { single })}
            {...(after === undefined ? {} : { after })}
            onClose={(changed) => {
              closes.push(changed);
              setOpen(false);
            }}
          />
        </PageFlashContext>
      </AreaRootContext>
    </div>
  );
}

async function openDialog(props: HarnessProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole('button', { name: 'Open' });
  act(() => {
    opener.focus();
  });
  fireEvent.click(opener);
  const modal = await waitFor(() => {
    const found = createWrapper().findModal();
    if (!found) throw new Error('Expected the delete modal');
    return found;
  });
  const dialog = modal.getElement();
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  if (props.settle !== false) {
    await waitFor(() => {
      expect(dialog.textContent).not.toContain(PENDING);
    });
  }
  return { dialog, modal, opener };
}

/** Matches the element whose whole text is `text`, and none of its children alone. */
function byWholeText(text: string) {
  return (_: string, element: Element | null): boolean =>
    element !== null &&
    element.textContent === text &&
    [...element.children].every((child) => child.textContent !== text);
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function deleteButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: 'Delete' });
}

function type(dialog: HTMLElement, text: string) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: text } });
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
}

async function confirm(dialog: HTMLElement) {
  type(dialog, 'delete');
  fireEvent.click(deleteButton(dialog));
}

const MARKER = 'A delete marker is added to each; the versions are kept.';
const SUSPENDED =
  'Versioning is suspended: the version of each object without a version ID is removed; versions kept while versioning was enabled stay.';
const PENDING = 'Checking whether the bucket keeps versions…';
const UNREAD = "Bucket Versioning could not be read, so it isn't known whether the versions are kept.";

describe('the delete dialog, what it says', () => {
  it.each([
    [{ keys: ['a.txt'], folders: [] }, undefined, 'Delete 1 object?'],
    [{ keys: ['a.txt', 'b.txt'], folders: ['tmp/'] }, undefined, 'Delete 2 objects and 1 folder?'],
    [{ keys: [], folders: ['tmp/', 'logs/'] }, undefined, 'Delete 2 folders?'],
    [{ keys: ['cfg/app.json'], folders: [] }, 'cfg/app.json', 'Delete cfg/app.json?'],
  ])('%j (single %s) → the header "%s"', async (selection, single, header) => {
    const { dialog } = await openDialog({ selection, ...(single === undefined ? {} : { single }) });
    expect(within(dialog).getByText(byWholeText(header))).toBeInTheDocument();
  });

  it('names each object and folder selected, and what is removed', async () => {
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: ['tmp/'] } });
    const list = within(dialog).getByRole('list', { name: 'Selected objects and folders' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['a.txt', 'tmp/']);
    expect(
      within(dialog).getByText(
        byWholeText(
          "These are removed from alpha in your local emulator, with every object under each folder. This can't be undone.",
        ),
      ),
    ).toBeInTheDocument();
  });

  it('keeps the count in the list dialog and distinguishes both selected keys', async () => {
    const keys = ['a b', 'a  b'];
    engine.keys = [...keys];
    const { dialog, modal } = await openDialog({ selection: { keys, folders: [] } });

    expect(dialog).toHaveAccessibleName('Delete 2 objects?');
    expect(modal.findHeader().findHeader()?.findHeadingText().getElement().textContent).toBe('Delete 2 objects?');
    const list = within(modal.findContent().getElement()).getByRole('list', { name: 'Selected objects and folders' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first?.textContent).toBe('a b');
    expect(second?.querySelector('[aria-hidden="true"]')?.textContent).toBe('a  b (a\\u0020\\u0020b)');

    await confirm(dialog);
    await waitFor(() => expect(closes).toEqual([true]));
    expect(engine.deletes.map((seen) => deleteKeysOf(seen.body))).toEqual([keys]);
  });

  it('names the single-object dialog by the identity and deletes the stored key', async () => {
    const key = 'a  b';
    engine.keys = [key];
    const { dialog, modal } = await openDialog({ selection: { keys: [key], folders: [] }, single: key });

    expect(dialog).toHaveAccessibleName('Delete a\\u0020\\u0020b?');
    const visibleName = modal.findHeader().findHeader()?.findHeadingText().find('[aria-hidden="true"]')?.getElement();
    expect(visibleName).toBeVisible();
    expect(visibleName?.textContent).toBe('a  b (a\\u0020\\u0020b)');

    await confirm(dialog);
    await waitFor(() => expect(closes).toEqual([true]));
    expect(engine.deletes.map((seen) => deleteKeysOf(seen.body))).toEqual([[key]]);
  });

  it('leaves the single-object dialog name and visible header intact for an ordinary key', async () => {
    const key = 'a b';
    const { dialog, modal } = await openDialog({ selection: { keys: [key], folders: [] }, single: key });

    expect(dialog).toHaveAccessibleName('Delete a b?');
    const heading = modal.findHeader().findHeader()?.findHeadingText().getElement();
    expect(heading).toBeVisible();
    expect(heading?.textContent).toBe('Delete a b?');
  });

  it.each([
    [{ keys: ['a.txt', 'b.txt'], folders: [] }, undefined],
    [{ keys: ['cfg/app.json'], folders: [] }, 'cfg/app.json'],
  ])('%j (single %s), no folder: no folder clause', async (selection, single) => {
    const { dialog } = await openDialog({ selection, ...(single === undefined ? {} : { single }) });
    await waitFor(() => {
      expect(engine.seen.some((seen) => seen.url.searchParams.has('versioning'))).toBe(true);
    });
    expect(
      within(dialog).getByText(
        byWholeText("These are removed from alpha in your local emulator. This can't be undone."),
      ),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toContain('under each folder');
  });

  it('with versioning "Enabled" the delete-marker sentence is shown, and the delete is not said to be final', async () => {
    engine.versioning = 'Enabled';
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: ['tmp/'] } });
    await waitFor(() => {
      expect(
        within(dialog).getByText(
          byWholeText(
            'These are removed from alpha in your local emulator, with every object under each folder. ' + MARKER,
          ),
        ),
      ).toBeInTheDocument();
    });
    expect(dialog.textContent).not.toContain("can't be undone");
  });

  it('with versioning "Suspended" no delete-marker sentence; what is removed and what stays, and nothing final', async () => {
    engine.versioning = 'Suspended';
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
    expect(
      within(dialog).getByText(byWholeText('These are removed from alpha in your local emulator. ' + SUSPENDED)),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toContain(MARKER);
    expect(dialog.textContent).not.toContain("can't be undone");
  });

  it.each([['Disabled'], [undefined]])(
    'with versioning %s (never enabled), the delete is said to be final',
    async (status) => {
      engine.versioning = status;
      const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
      expect(dialog.textContent).not.toContain(MARKER);
      expect(dialog.textContent).toContain("This can't be undone.");
    },
  );

  it('while GetBucketVersioning has not answered, a neutral line, nothing final, and "Delete" is unavailable', async () => {
    let answer: (value: Answer) => void = () => undefined;
    engine.versioningAnswer = () =>
      new Promise<Answer>((resolve) => {
        answer = resolve;
      });
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] }, settle: false });
    expect(
      within(dialog).getByText(byWholeText('These are removed from alpha in your local emulator. ' + PENDING)),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toContain("can't be undone");
    expect(dialog.textContent).not.toContain(MARKER);
    type(dialog, 'delete');
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    fireEvent.click(deleteButton(dialog));
    expect(engine.deletes).toHaveLength(0);
    await act(async () => {
      answer(ok('<VersioningConfiguration/>'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(dialog.textContent).toContain("This can't be undone.");
    });
    expect(isDisabled(deleteButton(dialog))).toBe(false);
  });

  it.each([
    ['a failed read', () => errorAnswer(500, 'InternalError', 'boom')],
    ['no such bucket', () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist')],
  ])('after %s, versioning is said to be unread, and nothing final', async (_name, answer) => {
    engine.versioningAnswer = answer;
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
    await waitFor(() => {
      expect(
        within(dialog).getByText(byWholeText('These are removed from alpha in your local emulator. ' + UNREAD)),
      ).toBeInTheDocument();
    });
    expect(dialog.textContent).not.toContain("can't be undone");
    expect(dialog.textContent).not.toContain(MARKER);
    type(dialog, 'delete');
    expect(isDisabled(deleteButton(dialog))).toBe(false);
  });
});

describe('the delete dialog, its controls', () => {
  it('"Delete" is unavailable until "delete" is typed', async () => {
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    type(dialog, 'delet');
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    type(dialog, 'Delete');
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    type(dialog, 'delete');
    expect(isDisabled(deleteButton(dialog))).toBe(false);
    expect(engine.deletes).toHaveLength(0);
  });

  it.each([
    ['Esc', () => pressEscape()],
    ['"Cancel"', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
  ])('%s closes it, deletes nothing and returns focus', async (_name, close) => {
    const { dialog, opener } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
    close(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
    expect(closes).toEqual([false]);
    expect(engine.deletes).toHaveLength(0);
  });
});

describe('the delete dialog, what it deletes', () => {
  it("a folder's keys are listed page by page and all keys go in DeleteObjects batches of at most 1000", async () => {
    const folder = Array.from({ length: 2500 }, (_, index) => `tmp/${String(index).padStart(4, '0')}.txt`);
    engine.keys = ['a.txt', ...folder];
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: ['tmp/'] } });
    await confirm(dialog);

    await waitFor(() => {
      expect(closes).toEqual([true]);
    });
    expect(
      engine.lists.map((seen) => [seen.url.searchParams.get('prefix'), seen.url.searchParams.get('delimiter')]),
    ).toEqual([
      ['tmp/', null],
      ['tmp/', null],
      ['tmp/', null],
    ]);
    expect(engine.lists.map((seen) => seen.url.searchParams.get('continuation-token'))).toEqual([null, '1000', '2000']);
    const batches = engine.deletes.map((seen) => deleteKeysOf(seen.body));
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 501]);
    expect(new Set(batches.flat())).toEqual(new Set(['a.txt', ...folder]));
    expect(engine.deletes.every((seen) => seen.body.includes('<Quiet>false</Quiet>'))).toBe(true);
    expect(engine.keys).toEqual([]);
    expect(screen.getByTestId('flash')).toHaveTextContent('Deleted 2501 objects.');
  });

  it.each([
    [{ keys: ['a.txt'], folders: [] }, ['a.txt'], 'Deleted 1 object.'],
    [{ keys: ['b.txt'], folders: ['tmp/'] }, ['b.txt', 'tmp/1.txt', 'tmp/2.txt'], 'Deleted 3 objects.'],
  ])('the result counts deleted keys, a folder\'s included: %j → "%s"', async (selection, keys, text) => {
    engine.keys = keys;
    const { dialog } = await openDialog({ selection });
    await confirm(dialog);
    await waitFor(() => {
      expect(screen.getByTestId('flash').textContent).toBe(text);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('each key the emulator refused is listed with its message', async () => {
    engine.keys = ['a.txt', 'locked.txt'];
    engine.refuse.set('locked.txt', 'Access Denied because object protected by object lock.');
    const { dialog } = await openDialog({ selection: { keys: ['a.txt', 'locked.txt'], folders: [] } });
    await confirm(dialog);
    await waitFor(() => {
      expect(screen.getByTestId('flash')).toHaveTextContent('1 could not be deleted:');
    });
    expect(screen.getByTestId('flash')).toHaveTextContent('Deleted 1 object.');
    expect(screen.getByTestId('flash')).toHaveTextContent(
      'locked.txt: Access Denied because object protected by object lock.',
    );
  });

  it('after a delete with somewhere to lead, the result is handed to that address', async () => {
    engine.keys = ['cfg/app.json'];
    const { dialog } = await openDialog({
      selection: { keys: ['cfg/app.json'], folders: [] },
      single: 'cfg/app.json',
      after: '/aws/s3/buckets/alpha?prefix=cfg%2F',
    });
    await confirm(dialog);
    await waitFor(() => {
      expect(handedOver).toEqual(['/aws/s3/buckets/alpha?prefix=cfg%2F']);
    });
  });

  it('a failed call stops, says how many were deleted before it and shows the message', async () => {
    engine.keys = Array.from({ length: 2500 }, (_, index) => `tmp/${String(index).padStart(4, '0')}.txt`);
    engine.deleteAnswer = (call) =>
      call === 1 ? errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist') : undefined;
    const { dialog } = await openDialog({ selection: { keys: [], folders: ['tmp/'] } });
    await confirm(dialog);

    await waitFor(() => {
      expect(dialog.textContent).toContain('The specified bucket does not exist');
    });
    expect(dialog.textContent).toContain('Deleted 1000 objects before the failure.');
    expect(engine.deletes).toHaveLength(2);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(results).toEqual([]);
  });

  it('a failed listing stops before any delete, with 0 deleted', async () => {
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: ['tmp/'] } });
    engine.keys = [];
    // The bucket is gone before the folder is listed.
    const original = engine.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).searchParams.get('list-type') === '2') {
        const answer = errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
        return new Response(answer.body, { status: answer.status });
      }
      return original(request);
    });
    await confirm(dialog);
    await waitFor(() => {
      expect(dialog.textContent).toContain('Deleted 0 objects before the failure.');
    });
    expect(dialog.textContent).toContain('The specified bucket does not exist');
    expect(engine.deletes).toHaveLength(0);
  });

  it('while running the buttons are disabled and the dialog cannot be closed', async () => {
    engine.keys = ['a.txt'];
    let release: (answer: Answer) => void = () => undefined;
    engine.deleteAnswer = () =>
      new Promise<Answer>((resolve) => {
        release = resolve;
      });
    const { dialog } = await openDialog({ selection: { keys: ['a.txt'], folders: [] } });
    await confirm(dialog);
    await waitFor(() => {
      expect(engine.deletes).toHaveLength(1);
    });

    expect(isDisabled(within(dialog).getByRole('button', { name: 'Cancel' }))).toBe(true);
    expect(isDisabled(deleteButton(dialog))).toBe(true);
    pressEscape();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(closes).toEqual([]);

    act(() => {
      release(ok('<DeleteResult><Deleted><Key>a.txt</Key></Deleted></DeleteResult>'));
    });
    await waitFor(() => {
      expect(closes).toEqual([true]);
    });
    expect(screen.getByTestId('flash')).toHaveTextContent('Deleted 1 object.');
  });
});
