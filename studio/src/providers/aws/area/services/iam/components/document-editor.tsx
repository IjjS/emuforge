import FormField from '@cloudscape-design/components/form-field';
import Textarea from '@cloudscape-design/components/textarea';

// The field a policy document is edited in (issue 535, design "Shared parts inside IAM's folder"): a Cloudscape
// `Textarea` with its label, description and error text, which reports each change of its text. Used by the five
// editors, whose one check of a document is `documentErrorText` of `document-text.ts`. The text is sent as typed.

interface DocumentEditorProps {
  label: string;
  description?: string;
  /** Shown below the field; none while the text is accepted or not yet checked. */
  errorText?: string | undefined;
  value: string;
  onChange: (text: string) => void;
  /** A save is in flight: the field cannot be changed. */
  disabled?: boolean;
  /** Rows of the field. */
  rows?: number;
}

/** A document's field. */
export function DocumentEditor({
  label,
  description,
  errorText,
  value,
  onChange,
  disabled = false,
  rows = 16,
}: DocumentEditorProps) {
  return (
    <FormField label={label} description={description} errorText={errorText} stretch>
      <Textarea
        value={value}
        onChange={({ detail }) => {
          onChange(detail.value);
        }}
        disabled={disabled}
        rows={rows}
        spellcheck={false}
        invalid={errorText !== undefined}
      />
    </FormField>
  );
}
