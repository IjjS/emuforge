import { describe, expect, it } from 'vitest';

import {
  classError,
  databaseNameError,
  identifierError,
  masterUserNameConstraint,
  masterUserNameError,
  passwordError,
  storageError,
} from './form';


describe('the checks of the forms', () => {
  it('an identifier', () => {
    expect(identifierError('')).toBe('Enter an identifier.');
    expect(identifierError('a'.repeat(64))).toBe('An identifier can have up to 63 characters.');
    expect(identifierError('a_b')).toBe('An identifier can hold letters, digits and hyphens only.');
    expect(identifierError('é')).toBe('An identifier can hold letters, digits and hyphens only.');
    expect(identifierError('1abc')).toBe('An identifier begins with a letter.');
    expect(identifierError('abc-')).toBe('An identifier cannot end with a hyphen.');
    expect(identifierError('a--b')).toBe('An identifier cannot have two hyphens in a row.');
    expect(identifierError(`a${'b1-'.repeat(20)}z9`)).toBeUndefined();
    expect(`a${'b1-'.repeat(20)}z9`).toHaveLength(63);
    expect(identifierError('Ab-1')).toBeUndefined();
  });

  it('a class', () => {
    expect(classError('')).toBe('Enter a class.');
    expect(classError('db.t3.micro')).toBeUndefined();
    expect(classError('anything')).toBeUndefined();
  });

  it('the storage', () => {
    expect(storageError('')).toBe('Enter the storage.');
    for (const value of ['19', '65537', '20.5', 'abc']) {
      expect(storageError(value), value).toBe('The storage is a whole number from 20 to 65536.');
    }
    expect(storageError('20')).toBeUndefined();
    expect(storageError('65536')).toBeUndefined();
  });

  it('a master user name', () => {
    expect(masterUserNameError('', 'postgres')).toBe('Enter a master user name.');
    expect(masterUserNameError('a'.repeat(64), 'postgres')).toBe('A master user name can have up to 63 characters.');
    expect(masterUserNameError('a'.repeat(63), 'postgres')).toBeUndefined();
    expect(masterUserNameError('a'.repeat(17), 'aurora-postgresql')).toBeUndefined();
    for (const engine of ['mysql', 'mariadb', 'aurora-mysql']) {
      expect(masterUserNameError('a'.repeat(17), engine), engine).toBe(
        'A master user name can have up to 16 characters.',
      );
      expect(masterUserNameError('a'.repeat(16), engine), engine).toBeUndefined();
    }
    expect(masterUserNameError('a_b', 'postgres')).toBe('A master user name can hold letters and digits only.');
    expect(masterUserNameError('1abc', 'postgres')).toBe('A master user name begins with a letter.');
  });

  it("a master user name's constraint reads 63 for postgres and aurora-postgresql, 16 for the other three", () => {
    for (const engine of ['postgres', 'aurora-postgresql']) {
      expect(masterUserNameConstraint(engine)).toBe('1 to 63 letters and digits, beginning with a letter.');
    }
    for (const engine of ['mysql', 'mariadb', 'aurora-mysql']) {
      expect(masterUserNameConstraint(engine)).toBe('1 to 16 letters and digits, beginning with a letter.');
    }
  });

  it('a password', () => {
    const chars = 'A master password can hold printable ASCII characters only, without /, @, " and spaces.';
    expect(passwordError('')).toBe('Enter a master password.');
    expect(passwordError('a'.repeat(7))).toBe('A master password has at least 8 characters.');
    expect(passwordError('a'.repeat(129))).toBe('A master password can have up to 128 characters.');
    for (const bad of ['abcd/efgh', 'abcd@efgh', 'abcd"efgh', 'abcd efgh', 'abcdéfgh']) {
      expect(passwordError(bad), bad).toBe(chars);
    }
    expect(passwordError('Ab1!#$%^')).toBeUndefined();
    expect(passwordError('~'.repeat(128))).toBeUndefined();
  });

  it('a database name', () => {
    expect(databaseNameError('')).toBeUndefined();
    expect(databaseNameError('a'.repeat(64))).toBe('A database name can have up to 63 characters.');
    expect(databaseNameError('a-b')).toBe('A database name can hold letters, digits and underscores only.');
    expect(databaseNameError('1abc')).toBe('A database name begins with a letter.');
    expect(databaseNameError('app_db1')).toBeUndefined();
  });
});
