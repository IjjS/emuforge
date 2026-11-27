import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import { useImperativeHandle, useRef, type Ref } from 'react';

import type { TagRow, TagRowError } from '../lib/tag-rows';

export interface TagsFieldRef {
  focusKey: (index: number) => void;
}

interface TagsFieldProps {
  rows: readonly TagRow[];
  onChange: (rows: TagRow[]) => void;
  errors?: readonly (TagRowError | undefined)[] | undefined;
  disabled?: boolean | undefined;
  ref?: Ref<TagsFieldRef> | undefined;
}

/** The optional tags section. The form validates its rows on submit and focuses the first failing key. */
export function TagsField({ rows, onChange, errors, disabled, ref }: TagsFieldProps) {
  const keys = useRef(new Map<number, InputProps.Ref>());
  useImperativeHandle(
    ref,
    () => ({
      focusKey: (index) => keys.current.get(index)?.focus(),
    }),
    [],
  );

  const changeRow = (index: number, changes: Partial<TagRow>) => {
    onChange(rows.map((row, rowIndex) => (index === rowIndex ? { ...row, ...changes } : row)));
  };

  return (
    <Container header={<Header variant="h2">Tags - optional</Header>}>
      <AttributeEditor
        items={rows}
        addButtonText="Add tag"
        removeButtonText="Remove"
        disableAddButton={disabled === true}
        isItemRemovable={() => disabled !== true}
        onAddButtonClick={() => onChange([...rows, { key: '', value: '' }])}
        onRemoveButtonClick={({ detail }) => onChange(rows.filter((_, index) => index !== detail.itemIndex))}
        definition={[
          {
            label: 'Key',
            errorText: (_, index) => errors?.[index],
            control: (row, index) => (
              <Input
                ref={(key) => {
                  if (key === null) {
                    keys.current.delete(index);
                  } else {
                    keys.current.set(index, key);
                  }
                }}
                value={row.key}
                disabled={disabled === true}
                onChange={({ detail }) => changeRow(index, { key: detail.value })}
              />
            ),
          },
          {
            label: 'Value - optional',
            control: (row, index) => (
              <Input
                value={row.value}
                disabled={disabled === true}
                onChange={({ detail }) => changeRow(index, { value: detail.value })}
              />
            ),
          },
        ]}
      />
    </Container>
  );
}
