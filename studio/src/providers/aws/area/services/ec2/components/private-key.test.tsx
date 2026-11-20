import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrivateKey } from './private-key';

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n';

let fetchSpy: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the private key', () => {
  it('is shown as text, exactly as given, with a copy control that puts that text on the clipboard', async () => {
    render(<PrivateKey name="dev" format="pem" privateKey={KEY} />);
    const field = screen.getByRole('textbox', { name: 'Private key' });
    expect((field as HTMLTextAreaElement).value).toBe(KEY);
    expect(field).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: /Copy private key/ }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(KEY);
    });
  });

  it('"Save as {name}.pem" → a file of that name whose text is the key; no request; the URL is released after', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const created = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:studio/1';
    });
    const revoked = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    render(<PrivateKey name="my key" format="ppk" privateKey={KEY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as my key.ppk' }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('my key.ppk');
    expect(clicked[0]?.getAttribute('href')).toBe('blob:studio/1');
    expect(await blobs[0]?.text()).toBe(KEY);
    expect(revoked).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(revoked).toHaveBeenCalledWith('blob:studio/1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a key that holds markup is shown as text', () => {
    const markup = '<b>bold</b><img src=x onerror="alert(1)">';
    const { container } = render(<PrivateKey name="dev" format="pem" privateKey={markup} />);
    expect((screen.getByRole('textbox', { name: 'Private key' }) as HTMLTextAreaElement).value).toBe(markup);
    expect(container.querySelector('b, img')).toBeNull();
  });
});
