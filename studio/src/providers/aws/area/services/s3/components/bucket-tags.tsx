import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import type { RefObject } from 'react';

import type { Tag } from '../api';
import { canAddTag, MAX_TAGS_REASON, type BucketForm, type TagMessages } from '../bucket-form';

// "Tags" of "Create bucket" (issue 256), lifted out of `create-bucket-page.tsx` (issue 469) so its limit of fifty tags
// is checked from rows given to it: past the limit "Add tag" is unavailable and says why (`canAddTag`).

export interface BucketTagsProps {
  form: BucketForm;
  /** One entry per tag, in the form's order. */
  messages: readonly TagMessages[];
  onChange: (update: (tags: Tag[]) => Tag[]) => void;
  /** A row was removed: its messages go with it. */
  onRemove: (index: number) => void;
  /** Each row's fields by `tag-key-<index>` and `tag-value-<index>`, where focus is moved to. */
  tagRefs: RefObject<Map<string, InputProps.Ref>>;
}

/** The "Tags" container. */
export function BucketTags({ form, messages, onChange, onRemove, tagRefs }: BucketTagsProps) {
  const canAdd = canAddTag(form);

  const tagInput = (index: number, part: 'key' | 'value') => (
    <Input
      ref={(ref) => {
        const id = `tag-${part}-${String(index)}`;
        if (ref === null) {
          tagRefs.current.delete(id);
        } else {
          tagRefs.current.set(id, ref);
        }
      }}
      value={form.tags[index]?.[part] ?? ''}
      invalid={messages[index]?.[part] !== undefined}
      autoComplete={false}
      spellcheck={false}
      onChange={({ detail }) => {
        onChange((tags) => tags.map((tag, at) => (at === index ? { ...tag, [part]: detail.value } : tag)));
      }}
    />
  );

  return (
    <Container header={<Header variant="h2">Tags</Header>}>
      <AttributeEditor
        items={form.tags}
        addButtonText="Add tag"
        removeButtonText="Remove"
        disableAddButton={!canAdd}
        {...(!canAdd && { additionalInfo: MAX_TAGS_REASON })}
        onAddButtonClick={() => {
          onChange((tags) => [...tags, { key: '', value: '' }]);
        }}
        onRemoveButtonClick={({ detail }) => {
          onChange((tags) => tags.filter((_, at) => at !== detail.itemIndex));
          onRemove(detail.itemIndex);
        }}
        definition={[
          {
            label: 'Key',
            control: (_, index) => tagInput(index, 'key'),
            errorText: (_, index) => messages[index]?.key,
          },
          {
            label: 'Value',
            control: (_, index) => tagInput(index, 'value'),
            errorText: (_, index) => messages[index]?.value,
          },
        ]}
      />
    </Container>
  );
}
