export interface LogGroupTag {
  key: string;
  value: string;
}

export interface TagErrors {
  key?: string;
  value?: string;
}

export const MAX_TAGS = 50;
export const TAG_LIMIT_MESSAGE = 'You can add up to 50 tags.';

export function validateTags(tags: readonly LogGroupTag[]) {
  const seen = new Set<string>();
  const rows = tags.map(({ key, value }): TagErrors => {
    const errors: TagErrors = {};
    if (key.length === 0 || [...key].length > 128) {
      errors.key = 'Enter a key of 1 to 128 characters.';
    } else if (key.startsWith('aws:')) {
      errors.key = 'A tag key cannot start with aws:.';
    } else if (seen.has(key)) {
      errors.key = 'Enter a unique tag key.';
    }
    seen.add(key);
    if ([...value].length > 256) {
      errors.value = 'Enter a value of up to 256 characters.';
    }
    return errors;
  });
  return { rows, limit: tags.length > MAX_TAGS ? TAG_LIMIT_MESSAGE : undefined };
}

export function tagsToRecord(tags: readonly LogGroupTag[]): Record<string, string> {
  return Object.fromEntries(tags.map(({ key, value }) => [key, value]));
}

export function tagChanges(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>) {
  return {
    remove: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
    put: Object.fromEntries(
      Object.entries(after).filter(([key, value]) => !Object.hasOwn(before, key) || before[key] !== value),
    ),
  };
}
