import { describe, expect, it } from 'vitest';

import { keyNameMessage, publicKeyMessage } from './key-pair-form';

describe("a key pair's name", () => {
  it('empty → "Enter a name."', () => {
    expect(keyNameMessage('')).toBe('Enter a name.');
  });

  it('256 characters → "A name can have up to 255 characters."', () => {
    expect(keyNameMessage('a'.repeat(256))).toBe('A name can have up to 255 characters.');
  });

  it('a character that is not ASCII → "A name can hold ASCII characters only."', () => {
    expect(keyNameMessage('clé')).toBe('A name can hold ASCII characters only.');
    expect(keyNameMessage('키')).toBe('A name can hold ASCII characters only.');
  });

  it('255 ASCII characters with a space and punctuation → none', () => {
    const name = `dev key-1.(a)_!@#$%^&*+=[]{};:'",<>/?|~\``.padEnd(255, 'x');
    expect(name).toHaveLength(255);
    expect(keyNameMessage(name)).toBeUndefined();
    expect(keyNameMessage('a')).toBeUndefined();
  });
});

describe('the public key', () => {
  it('an import without a public key → "Enter a public key."; with one → none', () => {
    expect(publicKeyMessage('import', '')).toBe('Enter a public key.');
    expect(publicKeyMessage('import', '  \n')).toBe('Enter a public key.');
    expect(publicKeyMessage('import', 'ssh-ed25519 AAAA')).toBeUndefined();
  });

  it('a create asks for none', () => {
    expect(publicKeyMessage('create', '')).toBeUndefined();
  });
});
