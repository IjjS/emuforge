export function revealBelowBreadcrumbs(target: HTMLElement, mode: 'align' | 'if-covered') {
  const layout = target.closest('main');
  let row = layout?.querySelector<HTMLElement>('nav[aria-label="Breadcrumbs"]') ?? null;
  while (row !== null && row !== layout && getComputedStyle(row).position !== 'sticky') {
    row = row.parentElement;
  }

  const toolbar = row !== layout ? row?.getBoundingClientRect() : undefined;
  if (mode === 'if-covered') {
    if (toolbar === undefined) return;
    const bounds = target.getBoundingClientRect();
    if (bounds.top >= toolbar.bottom && bounds.bottom <= window.innerHeight) return;
  }

  // AppLayout's scroll padding clears Studio's bar. The mobile breadcrumb row adds its own height.
  const margin = target.style.scrollMarginTop;
  if (toolbar !== undefined) {
    target.style.scrollMarginTop = `calc(${toolbar.height}px + var(--space-static-xs-b6kz15))`;
  }
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  target.style.scrollMarginTop = margin;
}
