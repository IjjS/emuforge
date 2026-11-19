import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import TagEditor from '@cloudscape-design/components/tag-editor';
import type { RefObject } from 'react';

import { TAGS_MAX, type EditorTag } from './create-role-rules';

// "Add tags" of step 3 of "Create role" (issue 82, requirement R6.5), lifted out of `review-step.tsx` (issue 469) so
// its limit of fifty tags is checked from rows given to it: Cloudscape's tag editor, which offers no fifty-first tag.

export interface RoleTagsProps {
  tags: readonly EditorTag[];
  onChange: (tags: readonly EditorTag[]) => void;
  /** The tag editor's holder, where focus is moved to. */
  tagsRef: RefObject<HTMLDivElement | null>;
}

/** The "Add tags" container. */
export function RoleTags({ tags, onChange, tagsRef }: RoleTagsProps) {
  return (
    <Container header={<Header variant="h2">Add tags</Header>}>
      <div ref={tagsRef}>
        <TagEditor
          tags={tags}
          tagLimit={TAGS_MAX}
          onChange={({ detail }) => {
            onChange(detail.tags.map(({ key, value, existing }) => ({ key, value, existing })));
          }}
        />
      </div>
    </Container>
  );
}
