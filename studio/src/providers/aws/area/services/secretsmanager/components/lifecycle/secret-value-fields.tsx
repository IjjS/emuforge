import FileUpload from '@cloudscape-design/components/file-upload';
import FormField from '@cloudscape-design/components/form-field';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import type { ReactNode } from 'react';

import type { SecretDraft } from './secret-draft';

export function SecretValueFields({
  value,
  disabled,
  onChange,
  generate,
}: {
  value: SecretDraft;
  disabled: boolean;
  onChange: (value: SecretDraft) => void;
  generate?: ReactNode;
}) {
  return (
    <SpaceBetween size="m">
      <FormField label="Value type">
        <RadioGroup
          value={value.format}
          readOnly={disabled}
          items={[
            { value: 'string', label: 'String' },
            { value: 'binary', label: 'Binary file' },
          ]}
          onChange={({ detail }) =>
            onChange(detail.value === 'binary' ? { format: 'binary', file: undefined } : { format: 'string', text: '' })
          }
        />
      </FormField>
      {value.format === 'string' ? (
        <FormField label="Secret value" secondaryControl={generate}>
          <Textarea
            value={value.text}
            disabled={disabled}
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => onChange({ format: 'string', text: detail.value })}
          />
        </FormField>
      ) : (
        <FormField label="Secret file" description="The file is stored as binary data.">
          <FileUpload
            value={value.file ? [value.file] : []}
            onChange={({ detail }) => {
              if (!disabled) onChange({ format: 'binary', file: detail.value[0] });
            }}
            i18nStrings={{
              uploadButtonText: () => 'Choose file',
              dropzoneText: () => 'Drop file to upload',
              removeFileAriaLabel: (_, name) => `Remove ${name}`,
            }}
            showFileSize
          />
        </FormField>
      )}
    </SpaceBetween>
  );
}
