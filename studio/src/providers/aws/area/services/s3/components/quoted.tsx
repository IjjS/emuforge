import { ValueText } from '../../../components/value-text';

// A sentence of the S3 screens that quotes a name (issue 467, requirement R6): a flash, "Bucket not found", the
// sentence that says what an action removes, the list's "No matches".

/**
 * The name as a name, the words around it as free text. Its text is `before`, the name and `after`, character for
 * character.
 */
export function Quoted({ before, name, after }: { before: string; name: string; after: string }) {
  return (
    <>
      <ValueText kind="text" value={before} />
      <ValueText kind="name" value={name} />
      <ValueText kind="text" value={after} />
    </>
  );
}

/**
 * A sentence written elsewhere that quotes `name` between “ and ”: shown as `Quoted`, split at the first quoted
 * occurrence of the name; as free text when it quotes none.
 */
export function QuotedIn({ text, name }: { text: string; name: string }) {
  const quoted = `“${name}”`;
  const at = text.indexOf(quoted);
  if (at < 0) {
    return <ValueText kind="text" value={text} />;
  }
  return <Quoted before={text.slice(0, at + 1)} name={name} after={text.slice(at + 1 + name.length)} />;
}
