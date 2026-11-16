import type { ComponentType } from 'react';

import type { CheckResult } from '../lib/engine/engine-client';
import { AWS_PROVIDER } from '../providers/aws/provider';

/**
 * The connection Studio hands an open area: a plain value, which the area reads and never asks for itself. Studio's
 * frame checks the engine's connection status as Home does, when a page of the area opens and again 5 seconds after
 * each answer, for as long as a page of the area is open.
 */
export interface ProviderConnection {
  /** The answer to the latest completed check; `undefined` before the first answer. */
  result: CheckResult | undefined;
  /** The engine's address the page is configured with, `http://127.0.0.1:<engine port>`; `undefined` until known. */
  engineOrigin: string | undefined;
}

/** What Studio hands a provider's area when it renders it. */
export interface ProviderAreaProps {
  /**
   * A CSS selector of Studio's top bar. The area sits below it and keeps its own sticky parts clear of it (for the
   * AWS area, `AppLayout`'s `headerSelector`).
   */
  headerSelector: string;
  /**
   * Called with the title of the page the area shows, its `h1` (`Amazon Web Services`, a service's label, `Page not
   * found`), whenever it changes. Studio makes the document title from it.
   */
  onPageTitle: (title: string) => void;
  /**
   * Called with a function that moves focus to the content target of the page the area shows, whenever it changes,
   * and with `null` while the area names none. The target is the page's `h1`, or an element of the area's content
   * that holds the `h1` and the page's controls and is named by the `h1`, past the area's navigation and
   * breadcrumbs. Studio's "Skip to content" calls it; Studio finds no element of the area itself.
   */
  onContentTarget: (focus: (() => void) | null) => void;
  /**
   * How many route changes the document has seen since it loaded: `0` on a first load, one more each time the path
   * changes inside the open document (a link, a button, Back, Forward). The area moves focus to its content target,
   * once its page has rendered, when it first renders with a count above `0` and whenever the count changes; it
   * never moves focus while the count is `0`.
   */
  routeChanges: number;
  /** The engine's connection status, as Studio's frame last read it. */
  connection: ProviderConnection;
}

/** A service of a provider, as Home lists it. */
export interface ProviderService {
  label: string;
  /** The service's page, under the provider's segment (`/aws/s3`). */
  path: string;
}

/**
 * One cloud provider Studio has an area for. The frame, Home and the router read these entries and name no provider
 * themselves; adding a provider is one entry here and the provider's own folder under `providers/`.
 */
export interface Provider {
  /** The provider's name: `Amazon Web Services`. */
  name: string;
  /** The provider's name in the frame: `AWS`. */
  shortName: string;
  /** The provider's first path segment, without slashes: `aws`. Every path below it is the area's. */
  segment: string;
  /** The provider's services, in the order Home lists them. */
  services: readonly ProviderService[];
  /**
   * Loads the area: the component that renders everything under the segment, with its own design system and colour
   * mode. Called only when a path of the area is opened, so nothing of the area loads before.
   */
  loadArea: () => Promise<{ default: ComponentType<ProviderAreaProps> }>;
}

/** Studio's providers, in the order the frame and Home show them. */
export const PROVIDERS: readonly Provider[] = [AWS_PROVIDER];
