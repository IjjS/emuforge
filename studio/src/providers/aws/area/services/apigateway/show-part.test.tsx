import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { useShowPart } from './show-part';

function Sections({ loaded }: { loaded: boolean }) {
  const headingRef = useShowPart('resources');
  return (
    <>
      <h1>API</h1>
      {loaded && (
        <h2 ref={headingRef} tabIndex={-1}>
          Resources
        </h2>
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
    expect(scroll).not.toHaveBeenCalled();
    page.rerender(
      <MemoryRouter initialEntries={['/?show=resources']}>
        <Sections loaded />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Resources' })).toHaveFocus();
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
