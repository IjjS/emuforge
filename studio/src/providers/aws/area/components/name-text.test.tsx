import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NameText } from './name-text';

describe('NameText', () => {
  it('draws an ordinary name through the value element and uses it as the accessible name', () => {
    render(
      <h1>
        <NameText name="a b" />
      </h1>,
    );
    const heading = screen.getByRole('heading', { name: 'a b' });
    expect(heading.textContent).toBe('a b');
    expect(heading.childElementCount).toBe(1);
    expect(heading.firstElementChild).toHaveClass('aws-area-value-name');
  });

  it('draws both spaces and the identity, and names the link with the identity alone', () => {
    render(
      <a href="/thing">
        <NameText name="a  b" />
      </a>,
    );
    const link = screen.getByRole('link', { name: 'a\\u0020\\u0020b' });
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('a  b (a\\u0020\\u0020b)');
  });

  it('draws a name with a backslash alone and doubles it in the heading’s accessible name', () => {
    render(
      <h1>
        <NameText name={'a\\b'} />
      </h1>,
    );
    const heading = screen.getByRole('heading', { name: 'a\\\\b' });
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe('a\\b');
  });

  it('gives a literal lookalike a different accessible name', () => {
    render(
      <>
        <h1>
          <NameText name="a  b" />
        </h1>
        <h2>
          <NameText name={'a b (a\\u0020\\u0020b)'} />
        </h2>
      </>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('a\\u0020\\u0020b');
    expect(screen.getByRole('heading', { level: 2 })).toHaveAccessibleName('a b (a\\\\u0020\\\\u0020b)');
  });

  it('draws the supplied display text and takes the identity from the stored name', () => {
    render(
      <h1>
        <NameText name={'a\r\nb'} display={'a\nb'} />
      </h1>,
    );
    const heading = screen.getByRole('heading', { name: 'a\\r\\nb' });
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe('a\nb (a\\r\\nb)');
  });

  it.each([undefined, null, ''])('shows the fallback for %j', (name) => {
    const { container } = render(<NameText name={name} none="-" />);
    expect(container.textContent).toBe('-');
  });
});
