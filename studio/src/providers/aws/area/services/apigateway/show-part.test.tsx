import Header from '@cloudscape-design/components/header';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { useShowPart } from './show-part';

function Sections({ loaded }: { loaded: boolean }) {
  const headingRef = useShowPart('resources');
  return (
    <>
      <h1>API</h1>
      {loaded && (
        <Header variant="h2">
          <span
            ref={(text) => {
              const heading = text?.closest('h2') ?? null;
              if (heading !== null) heading.tabIndex = -1;
              headingRef(heading);
            }}
          >
            Resources
          </span>
        </Header>
      )}
    </>
  );
}

it('scrolls and focuses the requested part as soon as its heading mounts', () => {
  const scroll = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const page = render(
      <MemoryRouter initialEntries={['/?show=resources']}>
        <Sections loaded={false} />
      </MemoryRouter>,
    );
    page.rerender(
      <MemoryRouter initialEntries={['/?show=resources']}>
        <Sections loaded />
      </MemoryRouter>,
    );
    const heading = createWrapper(page.container).findHeader()?.findHeadingText().getElement().closest('h2');
    expect(heading).toHaveTextContent('Resources');
    expect(heading).toHaveFocus();
    expect(scroll).toHaveBeenCalledOnce();
  } finally {
    if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it.each(['/', '/?show=unknown'])('leaves focus alone at %s', (path) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sections loaded />
    </MemoryRouter>,
  );
  expect(document.body).toHaveFocus();
});
