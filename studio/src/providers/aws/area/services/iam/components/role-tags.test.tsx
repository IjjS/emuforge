import { I18nProvider } from '@cloudscape-design/components/i18n';
import englishMessages from '@cloudscape-design/components/i18n/messages/all.en';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorTag } from './create-role-rules';
import { RoleTags } from './role-tags';

// The "Add tags" container of step 3 of "Create role" at its limit of fifty tags, from forty-nine rows given to it
// and kept by a holder the way the wizard keeps them (test-criteria.md, issue 469, "Unit s1 —
// iam/components/role-tags.test.tsx").

function givenTags(count: number): EditorTag[] {
  return Array.from({ length: count }, (_, at) => ({ key: `key${String(at + 1)}`, value: 'v', existing: false }));
}

function Holder({ tags }: { tags: EditorTag[] }) {
  const [held, setHeld] = useState<readonly EditorTag[]>(tags);
  const tagsRef = useRef<HTMLDivElement>(null);
  return <RoleTags tags={held} onChange={setHeld} tagsRef={tagsRef} />;
}

/** The holder with `count` tags given, inside Cloudscape's English messages, as the area's layout renders a page. */
function given(count: number) {
  render(
    <I18nProvider locale="en" messages={[englishMessages]}>
      <Holder tags={givenTags(count)} />
    </I18nProvider>,
  );
}

function rows() {
  const editor = createWrapper(document.body).findTagEditor();
  expect(editor).not.toBeNull();
  return (editor as NonNullable<typeof editor>).findRows();
}

function addNewTag() {
  fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
}

afterEach(() => {
  cleanup();
});

describe('"Add tags" at the limit of fifty', () => {
  it('forty-nine tags given, "Add new tag" → fifty rows', () => {
    given(49);
    expect(rows()).toHaveLength(49);
    addNewTag();
    expect(rows()).toHaveLength(50);
  });

  it('forty-nine tags given, "Add new tag" twice → still fifty rows after the second press', () => {
    given(49);
    addNewTag();
    expect(rows()).toHaveLength(50);
    addNewTag();
    expect(rows()).toHaveLength(50);
  });
});
