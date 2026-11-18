import { I18nProvider } from '@cloudscape-design/components/i18n';
import englishMessages from '@cloudscape-design/components/i18n/messages/all.en';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import type { InputProps } from '@cloudscape-design/components/input';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Tag } from '../api';
import { initialBucketForm, type BucketForm } from '../bucket-form';
import { BucketTags } from './bucket-tags';

// The "Tags" container of "Create bucket" at its limit of fifty tags, from forty-nine rows given to it and kept by a
// holder the way the form keeps them (test-criteria.md, issue 469, "Unit s1 — s3/components/bucket-tags.test.tsx").

const REASON = 'A bucket can have up to 50 tags.';

function givenTags(count: number): Tag[] {
  return Array.from({ length: count }, (_, at) => ({ key: `key${String(at + 1)}`, value: 'v' }));
}

function Holder({ tags }: { tags: Tag[] }) {
  const [form, setForm] = useState<BucketForm>(() => ({ ...initialBucketForm(), tags }));
  const tagRefs = useRef(new Map<string, InputProps.Ref>());
  return (
    <BucketTags
      form={form}
      messages={[]}
      onChange={(update) => {
        setForm((current) => ({ ...current, tags: update(current.tags) }));
      }}
      onRemove={() => undefined}
      tagRefs={tagRefs}
    />
  );
}

/** The holder with `count` tags given, inside Cloudscape's English messages, as the area's layout renders a page. */
function given(count: number) {
  render(
    <I18nProvider locale="en" messages={[englishMessages]}>
      <Holder tags={givenTags(count)} />
    </I18nProvider>,
  );
}

function editor() {
  const found = createWrapper(document.body).findAttributeEditor();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function addTag(): HTMLElement {
  return screen.getByRole('button', { name: 'Add tag' });
}

afterEach(() => {
  cleanup();
});

describe('"Tags" at the limit of fifty', () => {
  it('forty-nine tags given → forty-nine rows of "Key" and "Value", "Add tag" available, no reason', () => {
    given(49);
    expect(editor().findRows()).toHaveLength(49);
    expect(screen.queryAllByRole('textbox', { name: 'Key' })).toHaveLength(49);
    expect(screen.queryAllByRole('textbox', { name: 'Value' })).toHaveLength(49);
    expect(addTag()).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('forty-nine tags given, "Add tag" → fifty rows; "Add tag" unavailable and the reason shown', () => {
    given(49);
    fireEvent.click(addTag());
    expect(editor().findRows()).toHaveLength(50);
    expect(screen.queryAllByRole('textbox', { name: 'Key' })).toHaveLength(50);
    expect(addTag()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it('forty-nine tags given, "Add tag" twice → still fifty rows after the second press', () => {
    given(49);
    fireEvent.click(addTag());
    expect(editor().findRows()).toHaveLength(50);
    fireEvent.click(addTag());
    expect(editor().findRows()).toHaveLength(50);
  });
});
