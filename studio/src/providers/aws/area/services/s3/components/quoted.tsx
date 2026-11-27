import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';

// A sentence of the S3 screens that quotes a name (issue 467, requirement R6): a flash, "Bucket not found", the
// sentence that says what an action removes, the list's "No matches".

/**
 * The name as a name, the words around it as free text. Enable the identity when the sentence names a dialog
 * that acts on an object key.
 */
export function Quoted({
  before,
  name,
  after,
  showIdentity = false,
}: {
  before: string;
  name: string;
  after: string;
  showIdentity?: boolean;
}) {
  return (
    <>
      <ValueText kind="text" value={before} />
      {showIdentity ? <NameText name={name} /> : <ValueText kind="name" value={name} />}
      <ValueText kind="text" value={after} />
    </>
  );
}
