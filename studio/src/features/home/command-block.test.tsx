import { fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startEmulatorCommand } from './commands';
import { COPY_SAID_MS } from './copy-region';
import {
  advance,
  commandsIn,
  connectionNotice,
  connectionSection,
  emulatorDown,
  FakeEngine,
  norm,
  politeRegions,
  present,
  renderApp,
} from '../../test/home-test-kit';

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  engine.healthAnswers = [emulatorDown('not_started', 9297)];
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** Opens Home in the "not started" state, whose notice shows the start command. */
async function openStartCommand(): Promise<HTMLElement> {
  renderApp('/');
  await advance();
  return within(connectionNotice()).getByRole('group', { name: 'Command: start emulator' });
}

/** Gives the page a clipboard whose writes `write` answers, recording each text it is asked to hold. */
function clipboard(write: (text: string) => Promise<void>): string[] {
  const held: string[] = [];
  const writeText = vi.fn(async (text: string) => {
    await write(text);
    held.push(text);
  });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return held;
}

/**
 * Records every text a polite region of the "Connection" section other than the state's takes; each change of the
 * copy region's content is one announcement.
 */
function recordCopyAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((records) => {
    const changed = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const region = target?.closest('[aria-live="polite"]');
      if (region) changed.add(region);
    }
    for (const region of changed) {
      const text = norm(region.textContent);
      if (text.startsWith('Command')) said.push(text);
    }
  });
  observer.observe(connectionSection(), { subtree: true, childList: true, characterData: true });
  return said;
}

/** The polite region that says what a copy did: the section's region that is not the state's. */
function copyRegion(): HTMLElement {
  const regions = politeRegions();
  expect(regions).toHaveLength(2);
  return present(
    regions.find((region) => !/Engine|Emulator/.test(region.textContent ?? '')),
    'the copy region',
  );
}

describe('Command block: copy', () => {
  it('copies exactly the command shown, keeps "Copy" as its label, and announces "Command copied" once, outside the notice', async () => {
    const group = await openStartCommand();
    const held = clipboard(() => Promise.resolve());
    const said = recordCopyAnnouncements();
    const button = within(group).getByRole('button', { name: 'Copy command: start emulator' });
    fireEvent.click(button);
    await advance();
    expect(held).toEqual([startEmulatorCommand(9297)]);
    expect(held).toEqual([present(group.querySelector('pre'), 'the command').textContent]);
    expect(button).toHaveTextContent(/^Copy$/);
    expect(button).toHaveAccessibleName('Copy command: start emulator');
    expect(said).toEqual(['Command copied']);
    const region = copyRegion();
    expect(norm(region.textContent)).toBe('Command copied');
    expect(region.contains(connectionNotice())).toBe(false);
    expect(connectionNotice().contains(region)).toBe(false);
    // Said once: the region does not repeat it, and is cleared, so a second copy is heard again.
    await advance(COPY_SAID_MS);
    expect(said).toEqual(['Command copied']);
    expect(norm(region.textContent)).toBe('');
    fireEvent.click(button);
    await advance();
    expect(said).toEqual(['Command copied', 'Command copied']);
  });

  it('copies nothing and announces "Command not copied" when the clipboard refuses the write', async () => {
    const group = await openStartCommand();
    const held = clipboard(() => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')));
    const said = recordCopyAnnouncements();
    const button = within(group).getByRole('button', { name: 'Copy command: start emulator' });
    fireEvent.click(button);
    await advance();
    expect(held).toEqual([]);
    expect(said).toEqual(['Command not copied']);
    expect(norm(copyRegion().textContent)).toBe('Command not copied');
    expect(button).toHaveTextContent(/^Copy$/);
  });

  it('announces "Command not copied" when the browser has no clipboard', async () => {
    const group = await openStartCommand();
    Reflect.deleteProperty(navigator, 'clipboard');
    const said = recordCopyAnnouncements();
    fireEvent.click(within(group).getByRole('button', { name: 'Copy command: start emulator' }));
    await advance();
    expect(said).toEqual(['Command not copied']);
  });
});

describe('Command block: the command', () => {
  it('shows the command as preformatted text, one line a line, inside a group named "Command: <name>"', async () => {
    const group = await openStartCommand();
    expect(group).toHaveAccessibleName('Command: start emulator');
    const pre = present(group.querySelector('pre'), 'the preformatted command');
    expect(pre.textContent).toBe(startEmulatorCommand(9297));
    // Preformatted: the lines are the command's own, nothing joins or breaks them.
    expect(commandsIn(connectionNotice())).toEqual([startEmulatorCommand(9297).split('\n')]);
    expect(pre.querySelector('br, wbr')).toBeNull();
    expect(getComputedStyle(pre).whiteSpace).toBe('pre');
  });
});
