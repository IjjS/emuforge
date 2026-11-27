import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import { useImperativeHandle, useRef, type Ref } from 'react';

import { MAX_TAGS, TAG_LIMIT_MESSAGE, type Tag, type validateTags } from '../../../components/tags';

export interface TagEditorRef {
  focus: (index: number, part: keyof Tag) => void;
}

interface TagEditorProps {
  tags: readonly Tag[];
  errors?: ReturnType<typeof validateTags>;
  disabled?: boolean;
  onChange: (tags: Tag[]) => void;
  ref?: Ref<TagEditorRef>;
}

export function TagEditor({ tags, errors, disabled, onChange, ref }: TagEditorProps) {
  const inputs = useRef(new Map<string, InputProps.Ref>());
  useImperativeHandle(ref, () => ({
    focus: (index, part) => inputs.current.get(`${String(index)}-${part}`)?.focus(),
  }));
  const atLimit = tags.length >= MAX_TAGS;

  function field(tag: Tag, index: number, part: keyof Tag) {
    const id = `${String(index)}-${part}`;
    return (
      <Input
        ref={(input) => {
          if (input === null) inputs.current.delete(id);
          else inputs.current.set(id, input);
        }}
        value={tag[part]}
        readOnly={disabled}
        autoComplete={false}
        spellcheck={false}
        onChange={({ detail }) =>
          onChange(tags.map((row, at) => (at === index ? { ...row, [part]: detail.value } : row)))
        }
      />
    );
  }

  return (
    <FormField errorText={errors?.limit}>
      <AttributeEditor
        items={tags}
        addButtonText="Add tag"
        removeButtonText="Remove"
        removeButtonAriaLabel={(tag) => (tag.key === '' ? 'Remove tag' : `Remove tag ${tag.key}`)}
        disableAddButton={disabled || atLimit}
        isItemRemovable={() => !disabled}
        additionalInfo={atLimit && errors?.limit === undefined ? TAG_LIMIT_MESSAGE : undefined}
        onAddButtonClick={() => {
          if (!disabled && !atLimit) onChange([...tags, { key: '', value: '' }]);
        }}
        onRemoveButtonClick={({ detail }) => {
          if (!disabled) onChange(tags.filter((_, index) => index !== detail.itemIndex));
        }}
        definition={[
          {
            label: 'Key',
            control: (tag, index) => field(tag, index, 'key'),
            errorText: (_, index) => errors?.rows[index]?.key,
          },
          {
            label: 'Value',
            control: (tag, index) => field(tag, index, 'value'),
            errorText: (_, index) => errors?.rows[index]?.value,
          },
        ]}
      />
    </FormField>
  );
}
