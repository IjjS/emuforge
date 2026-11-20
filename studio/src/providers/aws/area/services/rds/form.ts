// The pure checks of RDS's forms and their constraint texts (issue 573, requirement S2 and "EmuForge's own text"):
// each check answers the message of the first rule a value breaks, or `undefined` when it keeps them all. Each limit
// is one the emulator refused past it, or a narrower one the form keeps (requirement, the list under S7's text).

/** The longest identifier of a DB instance or a DB cluster. */
export const IDENTIFIER_MAX = 63;

export const IDENTIFIER_CONSTRAINT =
  '1 to 63 characters: letters, digits and hyphens. It begins with a letter, does not end with a hyphen and has no two hyphens in a row. Stored in lower case.';

/** A DB instance's or DB cluster's identifier. */
export function identifierError(value: string): string | undefined {
  if (value === '') {
    return 'Enter an identifier.';
  }
  if (value.length > IDENTIFIER_MAX) {
    return 'An identifier can have up to 63 characters.';
  }
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    return 'An identifier can hold letters, digits and hyphens only.';
  }
  if (!/^[A-Za-z]/.test(value)) {
    return 'An identifier begins with a letter.';
  }
  if (value.endsWith('-')) {
    return 'An identifier cannot end with a hyphen.';
  }
  if (value.includes('--')) {
    return 'An identifier cannot have two hyphens in a row.';
  }
  return undefined;
}

export const CLASS_DESCRIPTION = 'As the API names it, for example db.t3.micro.';

/** A DB instance class: given, and otherwise as the API names it. */
export function classError(value: string): string | undefined {
  return value === '' ? 'Enter a class.' : undefined;
}

export const STORAGE_MIN = 20;
export const STORAGE_MAX = 65536;
export const STORAGE_CONSTRAINT = 'A whole number from 20 to 65536.';

/** The allocated storage in GiB, as typed. */
export function storageError(value: string): string | undefined {
  if (value === '') {
    return 'Enter the storage.';
  }
  const ok = /^\d+$/.test(value) && Number(value) >= STORAGE_MIN && Number(value) <= STORAGE_MAX;
  return ok ? undefined : 'The storage is a whole number from 20 to 65536.';
}

/** The engines whose master user name has at most 16 characters. */
const SHORT_USER_ENGINES: ReadonlySet<string> = new Set(['mysql', 'mariadb', 'aurora-mysql']);

/** The longest master user name for `engine`: 16 for MySQL, MariaDB and Aurora MySQL, else 63. */
export function masterUserNameMax(engine: string): number {
  return SHORT_USER_ENGINES.has(engine) ? 16 : 63;
}

/** The constraint text of a master user name for `engine`. */
export function masterUserNameConstraint(engine: string): string {
  return `1 to ${String(masterUserNameMax(engine))} letters and digits, beginning with a letter.`;
}

/** A master user name for `engine`. */
export function masterUserNameError(value: string, engine: string): string | undefined {
  if (value === '') {
    return 'Enter a master user name.';
  }
  const max = masterUserNameMax(engine);
  if (value.length > max) {
    return `A master user name can have up to ${String(max)} characters.`;
  }
  if (!/^[A-Za-z0-9]+$/.test(value)) {
    return 'A master user name can hold letters and digits only.';
  }
  if (!/^[A-Za-z]/.test(value)) {
    return 'A master user name begins with a letter.';
  }
  return undefined;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PASSWORD_CONSTRAINT = '8 to 128 printable ASCII characters, without /, @, " and spaces.';

/** The description of the password of a form that creates `what` ("the DB instance", "the DB cluster"). */
export function passwordDescription(what: string): string {
  return `EmuForge Studio does not keep the password and the API does not return it: note it before you create ${what}.`;
}

/** A master password. */
export function passwordError(value: string): string | undefined {
  if (value === '') {
    return 'Enter a master password.';
  }
  if (value.length < PASSWORD_MIN) {
    return 'A master password has at least 8 characters.';
  }
  if (value.length > PASSWORD_MAX) {
    return 'A master password can have up to 128 characters.';
  }
  // Printable ASCII is `!` to `~`; the space is below it.
  if (!/^[!-~]+$/.test(value) || /[/@"]/.test(value)) {
    return 'A master password can hold printable ASCII characters only, without /, @, " and spaces.';
  }
  return undefined;
}

export const DATABASE_NAME_CONSTRAINT = '1 to 63 letters, digits and underscores, beginning with a letter.';

/** A database name, which may be left empty. */
export function databaseNameError(value: string): string | undefined {
  if (value === '') {
    return undefined;
  }
  if (value.length > 63) {
    return 'A database name can have up to 63 characters.';
  }
  if (!/^\w+$/.test(value)) {
    return 'A database name can hold letters, digits and underscores only.';
  }
  if (!/^[A-Za-z]/.test(value)) {
    return 'A database name begins with a letter.';
  }
  return undefined;
}
