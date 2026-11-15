import type { ComponentType } from 'react';

import { AWS_PROVIDER } from '../providers/aws/provider';

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
