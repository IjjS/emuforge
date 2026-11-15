import { useId } from 'react';

import { TILE_PATH, TILE_RADIUS, TILE_SIDE, TILE_TRANSFORM } from './brand-paths';

/**
 * EmuForge's tile (requirement R4.2, R6.2): the rounded square with the symbol, drawn by Studio's own markup from the
 * tile path every brand file holds, so no request is made for it and it is in the first paint. Its colours are the
 * classes' (`st-tile-ground`, `st-tile-bird`), set from `--st-*` properties by the rules of the place that shows it.
 * Decoration only (R6.3): hidden from assistive technology, with no text alternative; the link around it names it.
 */
export function BrandTile() {
  // The square clips the neck where it leaves through the bottom edge; one clip per tile, so ids never repeat.
  const clip = `st-tile-clip-${useId()}`;
  return (
    <svg
      className="st-tile"
      viewBox={`0 0 ${String(TILE_SIDE)} ${String(TILE_SIDE)}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <rect width={TILE_SIDE} height={TILE_SIDE} rx={TILE_RADIUS} />
        </clipPath>
      </defs>
      <rect className="st-tile-ground" width={TILE_SIDE} height={TILE_SIDE} rx={TILE_RADIUS} />
      <g clipPath={`url(#${clip})`}>
        <path className="st-tile-bird" fillRule="evenodd" transform={TILE_TRANSFORM} d={TILE_PATH} />
      </g>
    </svg>
  );
}
