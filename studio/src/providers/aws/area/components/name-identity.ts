/** The exact identity of a resource name, in a form that survives white space collapsing. */
export function nameIdentity(name: string): string {
  return name.replace(/ {2,}|^ | $|[\\\t\r\n\u2028\u2029]/g, (part) =>
    part.startsWith(' ') ? '\\u0020'.repeat(part.length) : ESCAPES[part]!,
  );
}

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\t': '\\t',
  '\r': '\\r',
  '\n': '\\n',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** Whether a name has white space that a browser would collapse, trim or turn into a break. */
export function holdsHiddenWhiteSpace(name: string): boolean {
  return / {2}|^ | $|[\t\r\n\u2028\u2029]/.test(name);
}

/** Show an option's exact label while retaining its value and other fields. */
export function identityOption<T extends { label?: string }>(option: T): T {
  if (option.label === undefined) return option;
  const label = nameIdentity(option.label);
  return label === option.label ? option : { ...option, label };
}

interface SearchableOption {
  value?: string;
  label?: string;
  description?: string;
  tags?: readonly string[];
}

/** Match the original option fields as Cloudscape does, as well as the label the field draws. */
export function optionMatches(option: SearchableOption, text: string): boolean {
  if (text === '') return true;
  const query = text.toLowerCase();
  const { value, label, description, tags = [] } = option;
  return [value, label, description, ...tags, identityOption(option).label].some((field) =>
    field?.toLowerCase().includes(query),
  );
}
