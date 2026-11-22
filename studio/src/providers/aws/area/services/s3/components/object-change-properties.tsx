import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';

import type { MetadataEntry } from '../api';

interface ObjectChangePropertiesProps {
  contentType: string;
  metadata: MetadataEntry[];
  keyErrors: (string | undefined)[];
  pending: boolean;
  onContentType: (value: string) => void;
  onMetadata: (rows: MetadataEntry[]) => void;
}

export function ObjectChangeProperties({
  contentType,
  metadata,
  keyErrors,
  pending,
  onContentType,
  onMetadata,
}: ObjectChangePropertiesProps) {
  const handleChange = (index: number, field: 'key' | 'value', value: string) => {
    onMetadata(metadata.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
  };

  return (
    <SpaceBetween size="m">
      <FormField label="Content type">
        <Input
          value={contentType}
          onChange={({ detail }) => onContentType(detail.value)}
          readOnly={pending}
          spellcheck={false}
        />
      </FormField>
      <SpaceBetween size="xs">
        <Box variant="h3">User metadata</Box>
        <AttributeEditor
          items={metadata}
          empty="No user metadata"
          addButtonText="Add metadata"
          removeButtonText="Remove"
          removeButtonAriaLabel={({ key }) => (key === '' ? 'Remove metadata entry' : `Remove metadata ${key}`)}
          i18nStrings={{ itemRemovedAriaLive: 'Metadata entry removed', errorIconAriaLabel: 'Error' }}
          disableAddButton={pending}
          isItemRemovable={() => !pending}
          onAddButtonClick={() => onMetadata([...metadata, { key: '', value: '' }])}
          onRemoveButtonClick={({ detail }) => onMetadata(metadata.filter((_, index) => index !== detail.itemIndex))}
          definition={[
            {
              label: 'Key',
              errorText: (_, index) => keyErrors[index],
              control: ({ key }, index) => (
                <Input
                  value={key}
                  readOnly={pending}
                  spellcheck={false}
                  onChange={({ detail }) => handleChange(index, 'key', detail.value)}
                />
              ),
            },
            {
              label: 'Value',
              control: ({ value }, index) => (
                <Input
                  value={value}
                  readOnly={pending}
                  spellcheck={false}
                  onChange={({ detail }) => handleChange(index, 'value', detail.value)}
                />
              ),
            },
          ]}
        />
      </SpaceBetween>
    </SpaceBetween>
  );
}
