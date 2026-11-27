import type { Tag } from '@aws-sdk/client-cloudwatch';

export interface TagRow {
  key: string;
  value: string;
}

export interface TagChanges {
  remove: string[];
  put: TagRow[];
}

export const MAX_TAGS = 50;
export const TAG_LIMIT_MESSAGE = 'An alarm can have up to 50 tags.';

const invalidCharacter = /[^\p{L}\p{N} +=._:/@-]/u;
const characterRule = 'Use only letters, digits, spaces, and + - = . _ : / @.';

export function tagRows(tags: readonly Tag[]): TagRow[] {
  return tags.map(({ Key, Value }) => ({ key: Key ?? '', value: Value ?? '' }));
}

export function validateTags(rows: readonly TagRow[]) {
  const seen = new Set<string>();
  return {
    limit: rows.length > MAX_TAGS ? TAG_LIMIT_MESSAGE : undefined,
    rows: rows.map(({ key, value }) => {
      const duplicate = seen.has(key);
      seen.add(key);
      let keyError: string | undefined;
      let valueError: string | undefined;
      if (key.length === 0 || Array.from(key).length > 128) keyError = 'Use 1 to 128 characters for a key.';
      else if (key.toLowerCase().startsWith('aws:')) keyError = 'A key must not start with aws:.';
      else if (invalidCharacter.test(key)) keyError = characterRule;
      else if (duplicate) keyError = 'Use each key only once.';

      if (Array.from(value).length > 256) valueError = 'Use up to 256 characters for a value.';
      else if (invalidCharacter.test(value)) valueError = characterRule;
      return { key: keyError, value: valueError };
    }),
  };
}

export function tagChanges(opened: readonly TagRow[], draft: readonly TagRow[]): TagChanges {
  const original = new Map(opened.map(({ key, value }) => [key, value]));
  const keys = new Set(draft.map(({ key }) => key));
  return {
    remove: opened.filter(({ key }) => !keys.has(key)).map(({ key }) => key),
    put: draft.filter(({ key, value }) => original.get(key) !== value),
  };
}

export function changesOwed(changes: TagChanges, latest: readonly TagRow[]): TagChanges {
  const current = new Map(latest.map(({ key, value }) => [key, value]));
  return {
    remove: changes.remove.filter((key) => current.has(key)),
    put: changes.put.filter(({ key, value }) => current.get(key) !== value),
  };
}

export function tagsAddedOutside(opened: readonly TagRow[], draft: readonly TagRow[], latest: readonly TagRow[]) {
  const knownKeys = new Set([...opened, ...draft].map(({ key }) => key));
  return latest.filter(({ key }) => !knownKeys.has(key));
}
