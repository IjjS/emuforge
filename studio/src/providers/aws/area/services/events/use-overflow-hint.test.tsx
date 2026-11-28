import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useOverflowHint } from './use-overflow-hint';

function ExampleTable({ hasRows }: { hasRows: boolean }) {
  const { tableSection, showOverflow } = useOverflowHint(hasRows);
  return (
    <div ref={tableSection}>
      {showOverflow && <p>Scroll sideways.</p>}
      <div>
        <table />
      </div>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('measures the table scroll region when rows appear and updates the hint on resize', () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let onResize: () => void = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;
      disconnect = disconnect;

      constructor(measure: () => void) {
        onResize = measure;
      }
    },
  );

  const { rerender } = render(<ExampleTable hasRows={false} />);
  const table = screen.getByRole('table');
  const scrollPane = table.parentElement;
  if (!scrollPane) throw new Error('Expected the table scroll region');
  vi.spyOn(scrollPane, 'scrollWidth', 'get').mockReturnValue(570);
  const clientWidth = vi.spyOn(scrollPane, 'clientWidth', 'get').mockReturnValue(348);
  const hint = () => screen.queryByRole('paragraph');
  expect(hint()).toBeNull();

  rerender(<ExampleTable hasRows />);
  expect(hint()).toBeVisible();
  expect(hint()).toHaveTextContent(/^Scroll sideways\.$/);
  expect(observe).toHaveBeenCalledWith(table);
  expect(observe).toHaveBeenCalledWith(scrollPane);

  clientWidth.mockReturnValue(570);
  act(onResize);
  expect(hint()).toBeNull();

  clientWidth.mockReturnValue(348);
  act(onResize);
  expect(hint()).toBeVisible();

  rerender(<ExampleTable hasRows={false} />);
  expect(hint()).toBeNull();
  expect(disconnect).toHaveBeenCalledOnce();
});
