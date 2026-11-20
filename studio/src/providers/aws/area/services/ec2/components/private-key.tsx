import Button from '@cloudscape-design/components/button';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';

import type { KeyFormat } from '../key-pair-api';

// The private key of a key pair just created, on S9 (issue 553, design task 5, "Where the private key is"): the key
// as text, exactly as the emulator gave it, in a read-only field that scrolls inside itself; a copy control that puts
// that text on the clipboard; and "Save as {name}.pem" (or `.ppk`), which hands the browser a file made on the page:
// a `Blob` of the text behind an object URL on a link with `download`, revoked after the click. No request is made
// for it, and nothing here stores the key: it lives in the props of the page that holds it.

export interface PrivateKeyProps {
  /** The key pair's name, as it was given: the file is `{name}.{format}`. */
  name: string;
  format: KeyFormat;
  /** The private key, exactly as the emulator gave it. */
  privateKey: string;
}

/** How many rows the field shows: a 2048-bit PEM key is some 28 lines; the rest scrolls. */
const ROWS = 12;

/** Hands the browser `text` to save as `fileName`, from an object URL made for the one click and revoked after. */
function saveText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  // Revoked once the click's download has taken the URL.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function PrivateKey({ name, format, privateKey }: PrivateKeyProps) {
  const fileName = `${name}.${format}`;
  return (
    <SpaceBetween size="s">
      <FormField label="Private key" stretch>
        <Textarea value={privateKey} readOnly rows={ROWS} spellcheck={false} ariaLabel="Private key" />
      </FormField>
      <SpaceBetween direction="horizontal" size="xs">
        <CopyToClipboard
          variant="button"
          textToCopy={privateKey}
          copyButtonText="Copy private key"
          copySuccessText="Private key copied"
          copyErrorText="Private key could not be copied"
          popoverRenderWithPortal={false}
        />
        <Button
          iconName="download"
          onClick={() => {
            saveText(privateKey, fileName);
          }}
        >
          {`Save as ${fileName}`}
        </Button>
      </SpaceBetween>
    </SpaceBetween>
  );
}
