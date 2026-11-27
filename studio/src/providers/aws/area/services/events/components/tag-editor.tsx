import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

import { MAX_TAGS, TAG_LIMIT_MESSAGE, type Tag, type validateTags } from '../../../components/tags';

export interface TagEditorRef {
  focus: (index: number, part: keyof Tag) => void;
}

interface TagEditorProps {
  tags: readonly Tag[];
  errors?: ReturnType<typeof validateTags> | undefined;
  disabled?: boolean;
  onChange: (tags: Tag[]) => void;
  ref?: Ref<TagEditorRef>;
}

export function TagEditor({ tags, errors, disabled = false, onChange, ref }: TagEditorProps) {
  const inputs = useRef(new Map<string, InputProps.Ref>());
  const addedRow = useRef<number>(undefined);
  const atLimit = tags.length >= MAX_TAGS;

  const focus = useCallback((index: number, part: keyof Tag) => {
    inputs.current.get(`${String(index)}-${part}`)?.focus();
  }, []);
  useImperativeHandle(ref, () => ({ focus }), [focus]);

  useLayoutEffect(() => {
    const index = addedRow.current;
    addedRow.current = undefined;
    if (index !== undefined && index < tags.length) focus(index, 'key');
  }, [focus, tags.length]);

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
          if (disabled || atLimit) return;
          addedRow.current = tags.length;
          onChange([...tags, { key: '', value: '' }]);
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
