import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';

import { confirmsName } from './confirms-name';

// The confirmation of a destructive action on a bucket by typing its name, as the console asks on its "Delete bucket"
// and "Empty bucket" pages (issue 256, requirement R7.2, R8.1; `studio/AGENTS.md`, "Inside a provider area"). S4 and
// S3 use it as it is, each with its own label; its rule is `confirms-name.ts`.

export interface BucketNameConfirmationProps {
  /** The field's label, EmuForge's own words. */
  label: string;
  /** The bucket's name, shown as the field's placeholder. */
  name: string;
  /** What is typed. */
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Enter in the field once it holds exactly the name: what the page's action does. */
  onConfirm: () => void;
}

/** The field the bucket's name is typed into; Enter does the page's action once the field holds exactly the name. */
export function BucketNameConfirmation({
  label,
  name,
  value,
  disabled = false,
  onChange,
  onConfirm,
}: BucketNameConfirmationProps) {
  return (
    <FormField label={label}>
      <Input
        value={value}
        placeholder={name}
        disabled={disabled}
        autoComplete={false}
        spellcheck={false}
        onChange={({ detail }) => {
          onChange(detail.value);
        }}
        onKeyDown={({ detail }) => {
          if (detail.key === 'Enter' && !detail.isComposing && !disabled && confirmsName(value, name)) {
            onConfirm();
          }
        }}
      />
    </FormField>
  );
}
