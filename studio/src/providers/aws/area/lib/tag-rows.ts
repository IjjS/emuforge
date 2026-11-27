export interface TagRow {
  key: string;
  value: string;
}

export type TagRowError = 'Enter a key.' | 'This key is already used.';

export interface TagRowsCheck {
  errors: (TagRowError | undefined)[];
  firstInvalid: number | undefined;
  tags: TagRow[];
}

/** Check the rows in order, counting the form's own first tag when it supplies one. */
export function checkTagRows(rows: readonly TagRow[], reservedKey?: string): TagRowsCheck {
  const used = new Set(reservedKey === undefined ? [] : [reservedKey]);
  const tags: TagRow[] = [];
  const errors = rows.map((row): TagRowError | undefined => {
    if (row.key === '') return row.value === '' ? undefined : 'Enter a key.';
    if (used.has(row.key)) return 'This key is already used.';

    used.add(row.key);
    tags.push(row);
    return undefined;
  });
  const firstInvalid = errors.findIndex((error) => error !== undefined);
  return { errors, firstInvalid: firstInvalid < 0 ? undefined : firstInvalid, tags };
}
