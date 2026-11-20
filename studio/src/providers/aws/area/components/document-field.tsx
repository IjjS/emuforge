import FormField from '@cloudscape-design/components/form-field';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import type { ReactNode, Ref } from 'react';

// The area's field of a text document (issue 575, design "What is shared"): a Cloudscape `Textarea` in a `FormField`
// with its label, description and error text, which reports each change of its text. The text is kept as typed: a
// caller checks it and sends it as it decides. IAM's `components/document-editor.tsx` is the same field inside IAM's
// folder until it is moved onto this one.

interface DocumentFieldProps {
  label: string;
  description?: ReactNode;
  /** Shown below the field; none while the text is accepted or not yet checked. */
  errorText?: ReactNode;
  value: string;
  onChange: (text: string) => void;
  /** A request is in flight: the text cannot be changed. */
  disabled?: boolean;
  /** Rows of the field. */
  rows?: number;
  /** The field's own handle, to take the focus. */
  textareaRef?: Ref<TextareaProps.Ref>;
}

/** A document's field. */
export function DocumentField({
  label,
  description,
  errorText,
  value,
  onChange,
  disabled = false,
  rows = 24,
  textareaRef,
}: DocumentFieldProps) {
  const invalid = errorText !== undefined && errorText !== null && errorText !== '';
  return (
    <FormField label={label} description={description} errorText={invalid ? errorText : undefined} stretch>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={({ detail }) => {
          onChange(detail.value);
        }}
        disabled={disabled}
        rows={rows}
        spellcheck={false}
        invalid={invalid}
      />
    </FormField>
  );
}
