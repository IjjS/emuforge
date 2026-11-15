/// <reference types="node" />
// The tile Studio draws in its frame (issue 36, test-criteria.md, "Unit — ui/brand-tile.test.tsx"): decoration
// (requirement R6.3), the tile of the brand files drawn by Studio's own markup (R4.2, R5.2, R6.2), coloured by its
// classes only, and without the code sign (R4.3). How it draws in the bar is the flow checks'
// (tests/integration/studio/frame-logo.spec.ts).

import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BrandTile } from './brand-tile';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `d` of the one `evenodd` path of `brand/logo-compact-light.svg`: the tile path every brand file holds. */
function logoTilePath(): string {
  const doc = new DOMParser().parseFromString(
    readFileSync(path.join(STUDIO, 'brand', 'logo-compact-light.svg'), 'utf8'),
    'image/svg+xml',
  );
  const marks = [...doc.getElementsByTagName('path')].filter((p) => p.getAttribute('fill-rule') === 'evenodd');
  expect(marks).toHaveLength(1);
  return marks[0]?.getAttribute('d') ?? '';
}

function renderTile(): SVGSVGElement {
  const { container } = render(<BrandTile />);
  const svgs = container.querySelectorAll('svg');
  expect(svgs).toHaveLength(1);
  return svgs[0] as SVGSVGElement;
}

/** A colour written as a value: a hex, a colour function or a named colour, anything but none and a paint server. */
function isColour(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v !== '' && v !== 'none' && !v.startsWith('url(');
}

describe("Studio's tile", () => {
  it('is one svg with a viewBox, hidden from assistive technology, with no title, desc, text or image', () => {
    const tile = renderTile();

    expect(tile.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile).toHaveAttribute('focusable', 'false');
    expect(tile).not.toHaveAttribute('tabindex');
    expect(tile.querySelectorAll('svg')).toHaveLength(0);
    for (const name of ['title', 'desc', 'text', 'image', 'foreignObject', 'use']) {
      expect(tile.getElementsByTagName(name), name).toHaveLength(0);
    }
    expect(tile.textContent).toBe('');
  });

  it('is a rounded square whose corner is 0.22 of its side, with the bird the logo files hold', () => {
    const tile = renderTile();
    const [, , width, height] = (tile.getAttribute('viewBox') ?? '').split(' ').map(Number);

    const ground = tile.querySelector(':scope > rect');
    expect(ground).not.toBeNull();
    const side = Number(ground?.getAttribute('width'));
    expect(Number(ground?.getAttribute('height'))).toBe(side);
    expect(side).toBe(width);
    expect(side).toBe(height);
    expect(ground?.getAttribute('x') ?? '0').toBe('0');
    expect(ground?.getAttribute('y') ?? '0').toBe('0');
    expect(Number(ground?.getAttribute('rx')) / side).toBeCloseTo(0.22, 6);

    const paths = tile.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveAttribute('fill-rule', 'evenodd');
    expect(paths[0]?.getAttribute('d')).toBe(logoTilePath());
  });

  it('holds no colour in fill, stroke or style; ground and bird carry a class; its ids are unique in the document', () => {
    render(
      <>
        <BrandTile />
        <BrandTile />
      </>,
    );
    const tiles = [...document.querySelectorAll('svg')];
    expect(tiles).toHaveLength(2);

    for (const tile of tiles) {
      for (const element of [tile, ...tile.querySelectorAll('*')]) {
        for (const name of ['fill', 'stroke', 'color', 'stop-color']) {
          const value = element.getAttribute(name);
          expect(value !== null && isColour(value), `${element.tagName} ${name}="${String(value)}"`).toBe(false);
        }
        expect(element.hasAttribute('style'), `${element.tagName} has a style attribute`).toBe(false);
      }
      expect(tile.querySelector(':scope > rect')?.getAttribute('class') ?? '').not.toBe('');
      expect(tile.querySelector('path')?.getAttribute('class') ?? '').not.toBe('');
    }

    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // Each tile's clip is its own: the reference names an id inside the same tile.
    for (const tile of tiles) {
      const reference = tile.querySelector('[clip-path]')?.getAttribute('clip-path') ?? '';
      const id = /^url\(#(.+)\)$/.exec(reference)?.[1];
      expect(id).toBeDefined();
      expect([...tile.querySelectorAll('[id]')].map((element) => element.id)).toContain(id);
    }
  });

  it('holds no code sign: no stroked path and no path but the bird', () => {
    const tile = renderTile();

    const paths = [...tile.querySelectorAll('path')];
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill-rule')).toBe('evenodd');
    for (const element of [tile, ...tile.querySelectorAll('*')]) {
      expect(element.getAttribute('stroke') ?? 'none').toBe('none');
      expect(element.hasAttribute('stroke-width')).toBe(false);
    }
  });
});
