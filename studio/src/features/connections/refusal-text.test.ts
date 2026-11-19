import { describe, expect, it } from 'vitest';

import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import { messagesFor } from '../../i18n/messages';
import { refusalText } from './refusal-text';

const { t } = messagesFor(BUNDLED_CATALOGUES, 'en');

describe('an add the engine refused', () => {
  it.each([
    ['TargetExists', 'A connection named second already exists. Choose another name.', 'name'],
    [
      'EndpointNotLoopback',
      'Use an address on this machine: https:// and an IP in 127.0.0.0/8 or [::1], with a port. Host names, localhost included, are not accepted.',
      'endpoint',
    ],
    ['TargetLimit', 'Studio already has 32 connections, the most there can be. Remove one first.', undefined],
    [
      'ComposeHoldsOneTarget',
      "This is EmuForge's Compose form. It holds one connection, its own emulator, and no other can be added.",
      undefined,
    ],
  ])('%s → its text, beside %s', (code, text, field) => {
    const { key, field: shownBeside } = refusalText(code);

    expect(t(key, { name: 'second' })).toBe(text);
    expect(shownBeside).toBe(field);
  });

  it.each(['TargetInvalid', 'SomethingNew', undefined, 'toString', '__proto__'])(
    '%s → "The engine refused the connection: {message}", under the form',
    (code) => {
      const { key, field } = refusalText(code);

      expect(t(key, { message: 'the scheme must be https://' })).toBe(
        'The engine refused the connection: the scheme must be https://',
      );
      expect(field).toBeUndefined();
    },
  );
});
