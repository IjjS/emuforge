// Times and numbers of Studio's own layer in the current language (requirement R5.3, R5.4).

import { describe, expect, it } from 'vitest';

import { catalogueSet, parseCatalogue } from './catalogue';
import { formatNumber, formatTime } from './format';
import { messagesFor } from './messages';

const TAGS = ['en', 'ko', 'ja', 'es', 'pt-BR', 'fr', 'de', 'ru', 'it', 'pl', 'vi', 'th'];
const OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };

describe('the check time', () => {
  const afternoon = new Date(2026, 10, 15, 16, 5, 12).getTime();
  const midnight = new Date(2026, 10, 15, 0, 5, 12).getTime();

  it.each(TAGS)('16:05:12 in %s → the text Intl.DateTimeFormat gives, hours 00 to 23', (tag) => {
    const intl = new Intl.DateTimeFormat(tag, OPTIONS);
    expect(formatTime(tag, afternoon)).toBe(intl.format(afternoon));
    expect(intl.formatToParts(afternoon).find((part) => part.type === 'hour')?.value).toBe('16');
  });

  it.each(TAGS)('00:05:12 in %s → hour 00', (tag) => {
    const intl = new Intl.DateTimeFormat(tag, OPTIONS);
    expect(formatTime(tag, midnight)).toBe(intl.format(midnight));
    expect(intl.formatToParts(midnight).find((part) => part.type === 'hour')?.value).toBe('00');
  });

  it('follows the language it is asked in', () => {
    expect(messagesFor<string>(catalogues(), 'de').formatTime(afternoon)).toBe(formatTime('de', afternoon));
  });
});

describe('counts', () => {
  it('1234 in German → 1.234', () => {
    expect(formatNumber('de', 1234)).toBe('1.234');
  });

  it("1234 in French → 1 234 with the separator Intl.NumberFormat('fr') gives", () => {
    const group = new Intl.NumberFormat('fr').formatToParts(1234).find((part) => part.type === 'group')?.value;
    expect(group).toMatch(/^\s$/u);
    expect(formatNumber('fr', 1234)).toBe(`1${group ?? ''}234`);
  });
});

/** Test catalogues whose messages hold a port, an address, an HTTP status and a count. */
function catalogues() {
  const english = 'No emulator on port {port} at {address}; the engine answered {status} for {count} checks.';
  return catalogueSet([
    parseCatalogue('en', { '@name': 'English', notice: { one: english, other: english } }),
    parseCatalogue('de', {
      '@name': 'Deutsch',
      notice: {
        one: 'Kein Emulator auf Port {port} unter {address}; die Engine antwortete {status} für {count} Prüfung.',
        other: 'Kein Emulator auf Port {port} unter {address}; die Engine antwortete {status} für {count} Prüfungen.',
      },
    }),
    parseCatalogue('fr', {
      '@name': 'Français',
      notice: {
        one: 'Aucun émulateur sur le port {port} à {address} ; le moteur a répondu {status} pour {count} vérification.',
        many: 'Aucun émulateur sur le port {port} à {address} ; le moteur a répondu {status} pour {count} vérifications.',
        other:
          'Aucun émulateur sur le port {port} à {address} ; le moteur a répondu {status} pour {count} vérifications.',
      },
    }),
  ]);
}

describe('literal values', () => {
  const values = { port: '9297', address: 'https://127.0.0.1:9297', status: '503' };

  it.each(['de', 'fr'])(
    'port 9297, an address and an HTTP status inside a %s message → exactly as given, never grouped',
    (tag) => {
      const text = messagesFor<string>(catalogues(), tag).plural('notice', 1234, values);
      expect(text).toContain(' 9297 ');
      expect(text).toContain('https://127.0.0.1:9297');
      expect(text).toContain(' 503 ');
      expect(text).not.toMatch(/9\D297/);
      // The count beside them is a number of the language.
      expect(text).toContain(formatNumber(tag, 1234));
    },
  );
});
