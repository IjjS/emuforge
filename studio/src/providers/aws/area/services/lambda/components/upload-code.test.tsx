import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import type { ChangeCallbacks, FunctionChange } from '../queries';
import { storedZip } from '../zip';
import { UploadCode } from './upload-code';

// "Upload a .zip file" on the tab "Code" (issue 516, test criteria "Unit s3 — components/upload-code.test.tsx"). The
// upload's hook is a stand-in of this file that holds each change until the case answers it; the request it stands
// for is `api.test.ts`'s.

interface HeldChange {
  input: Uint8Array;
  callbacks: ChangeCallbacks | undefined;
  answer: (failure?: RequestFailure) => void;
}

const held = vi.hoisted(() => ({ changes: [] as unknown[] }));

function useStandInChange(): FunctionChange<Uint8Array> {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    error: undefined,
    reset: () => undefined,
    mutate: (input, callbacks) => {
      if (isPending) {
        return;
      }
      setPending(true);
      const change: HeldChange = {
        input,
        callbacks,
        answer: (failure) => {
          setPending(false);
          if (failure === undefined) {
            callbacks?.onSuccess?.();
          } else {
            callbacks?.onError?.(failure);
          }
        },
      };
      held.changes.push(change);
    },
  };
}

vi.mock('../queries', () => ({
  useUpdateFunctionCode: () => useStandInChange(),
}));

const changes = () => held.changes as HeldChange[];

let shown: FlashResult[];

function renderUpload({ ready = true }: { ready?: boolean } = {}) {
  const flash: PageFlash = {
    show: (result) => {
      shown.push(result);
    },
    handOver: () => undefined,
  };
  return render(
    <PageFlashContext.Provider value={flash}>
      <UploadCode name="orders" engineOrigin="http://127.0.0.1:8999" ready={ready} />
    </PageFlashContext.Provider>,
  );
}

beforeEach(() => {
  held.changes = [];
  shown = [];
});

const ARCHIVE = storedZip('lambda_function.py', 'def lambda_handler(event, context):\n    return "v2"\n');

function zipFile(name = 'echo-v2.zip', bytes: Uint8Array = ARCHIVE): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/zip' });
}

function choose(file: File) {
  const upload = createWrapper(document.body).findFileUpload();
  if (upload === null) throw new Error('No file field');
  const input = upload.findNativeInput().getElement();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function chosenNames(): string[] {
  const upload = createWrapper(document.body).findFileUpload();
  return (upload?.findFileTokens() ?? []).map((token) => token.findFileName().getElement().textContent);
}

function uploadButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Upload(ing)?$/ });
}

/**
 * Presses "Upload" and lets the file be read: the check reads the file's end before anything is sent, so the press is
 * settled inside `act` with the tasks that read it.
 */
async function pressUpload() {
  await act(async () => {
    fireEvent.click(uploadButton());
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function fieldError(): string {
  const field = createWrapper(document.body).findFormField();
  return (field?.findError()?.getElement().textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('"Upload" refused before sending', () => {
  it('no file: "Choose a .zip file."; nothing sent', async () => {
    renderUpload();

    await pressUpload();

    expect(fieldError()).toBe('Choose a .zip file.');
    expect(changes()).toEqual([]);
  });

  it('a file that is no archive: "{file} is not a .zip archive."; nothing sent', async () => {
    renderUpload();
    choose(zipFile('notes.zip', new TextEncoder().encode('just some notes, not an archive')));

    await pressUpload();

    expect(fieldError()).toBe('notes.zip is not a .zip archive.');
    expect(changes()).toEqual([]);
  });
});

describe('an archive', () => {
  it('is sent with its bytes; in flight "Uploading" and the field unavailable; answered: the Flashbar and an empty field', async () => {
    renderUpload();
    choose(zipFile());
    expect(chosenNames()).toEqual(['echo-v2.zip']);

    await pressUpload();

    expect(changes()).toHaveLength(1);
    expect([...(changes()[0]?.input ?? [])]).toEqual([...ARCHIVE]);
    expect(uploadButton().textContent).toBe('Uploading');
    const input = createWrapper(document.body).findFileUpload()?.findNativeInput().getElement();
    expect(input?.matches(':disabled')).toBe(true);

    // A second press in flight sends nothing.
    await pressUpload();
    expect(changes()).toHaveLength(1);

    act(() => {
      changes()[0]?.answer();
    });

    expect(shown).toEqual([[{ type: 'success', content: 'Code uploaded to orders.' }]]);
    expect(chosenNames()).toEqual([]);
    expect(uploadButton().textContent).toBe('Upload');
    expect(input?.matches(':disabled')).toBe(false);
  });
});

describe('a failed upload', () => {
  it('a 413: "The emulator refused {file} as too large." with the status; the file still chosen', async () => {
    renderUpload();
    choose(zipFile('big.zip'));
    await pressUpload();
    expect(changes()).toHaveLength(1);

    act(() => {
      changes()[0]?.answer({ kind: 'other', operation: 'UpdateFunctionCode', code: 'HTTP 413' });
    });

    expect(fieldError()).toBe('The emulator refused big.zip as too large. HTTP 413');
    expect(chosenNames()).toEqual(['big.zip']);
    expect(shown).toEqual([]);
  });

  it('any other failure: under the field as the area words it; the file still chosen', async () => {
    renderUpload();
    choose(zipFile());
    await pressUpload();
    expect(changes()).toHaveLength(1);

    act(() => {
      changes()[0]?.answer({
        kind: 'other',
        operation: 'UpdateFunctionCode',
        code: 'ResourceConflictException',
        message: 'An update is in progress for resource: orders',
      });
    });

    const alert = createWrapper(document.body).findAlert();
    expect(alert?.findHeader()?.getElement().textContent).toBe('Uploading echo-v2.zip failed');
    expect(alert?.findContent().getElement().textContent).toBe(
      'ResourceConflictException: An update is in progress for resource: orders',
    );
    expect(fieldError()).toBe('');
    expect(chosenNames()).toEqual(['echo-v2.zip']);
    expect(shown).toEqual([]);
  });

  it('the engine not answering: the area’s words for it', async () => {
    renderUpload();
    choose(zipFile());
    await pressUpload();
    expect(changes()).toHaveLength(1);

    act(() => {
      changes()[0]?.answer({ kind: 'engine-did-not-answer', operation: 'UpdateFunctionCode' });
    });

    expect(createWrapper(document.body).findAlert()?.getElement().textContent).toContain(
      'The EmuForge engine at http://127.0.0.1:8999 did not answer',
    );
    expect(chosenNames()).toEqual(['echo-v2.zip']);
  });
});

describe('not ready', () => {
  it('"Upload" is unavailable with "Wait until the function is ready."; nothing sent', async () => {
    renderUpload({ ready: false });
    choose(zipFile());

    const button = uploadButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(button);
    expect(document.body.textContent).toContain('Wait until the function is ready.');
    await pressUpload();
    expect(changes()).toEqual([]);
  });
});
