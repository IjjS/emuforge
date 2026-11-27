// What S9, "Create key pair", checks before it sends (issue 553, requirement S9): the name has 1 to 255 ASCII
// characters (the emulator refuses 256 and a character that is not ASCII, and accepts a space and punctuation); an
// imported key is given. The first rule that fails is the field's message.

/** What S9 does: create a new key pair, or import a public key. */
export type KeyPairMode = 'create' | 'import';

/** The longest name the emulator accepts. */
export const KEY_NAME_MAX = 255;

export const KEY_NAME_RULE = '1 to 255 ASCII characters.';
export const KEY_NAME_EMPTY = 'Enter a name.';
export const KEY_NAME_TOO_LONG = 'A name can have up to 255 characters.';
export const KEY_NAME_ASCII = 'A name can hold ASCII characters only.';
export const PUBLIC_KEY_EMPTY = 'Enter a public key.';

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
}

/** What is wrong with a key pair's name, or `undefined` when nothing is. */
export function keyNameMessage(name: string): string | undefined {
  if (name === '') {
    return KEY_NAME_EMPTY;
  }
  if (name.length > KEY_NAME_MAX) {
    return KEY_NAME_TOO_LONG;
  }
  if (!isAscii(name)) {
    return KEY_NAME_ASCII;
  }
  return undefined;
}

/** What is wrong with the public key of `mode`, or `undefined` when nothing is: a create asks for none. */
export function publicKeyMessage(mode: KeyPairMode, publicKey: string): string | undefined {
  return mode === 'import' && publicKey.trim() === '' ? PUBLIC_KEY_EMPTY : undefined;
}

export const KEY_TYPE_OPTIONS = [
  { value: 'rsa', label: 'RSA', description: 'The emulator returns an RSA private key.' },
  { value: 'ed25519', label: 'ED25519', description: 'The emulator returns an ED25519 private key.' },
];

export const KEY_FORMAT_OPTIONS = [
  { value: 'pem', label: '.pem', description: 'The private key as PEM text.' },
  { value: 'ppk', label: '.ppk', description: "The private key in PuTTY's format." },
];
