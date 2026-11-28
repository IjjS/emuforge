import { useEffect, useRef, useState } from 'react';

export function useOverflowHint(hasRows: boolean) {
  const tableSection = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const table = tableSection.current?.querySelector('table');
    // Cloudscape puts the table directly inside its horizontal scroll region.
    const scrollPane = table?.parentElement;
    if (!hasRows || !table || !scrollPane) return;

    const measure = () => setOverflows(scrollPane.scrollWidth > scrollPane.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(scrollPane);
    return () => observer.disconnect();
  }, [hasRows]);

  return { tableSection, showOverflow: hasRows && overflows };
}
