import { EmptyPage } from '../components/empty-page';
import type { Service } from './services';

/** `/<service>` and every path below it, until the service has a screen (requirement 2.3). Calls nothing. */
export function NoScreenPage({ service }: { service: Service }) {
  return <EmptyPage title={service.label}>{`Studio has no screen for ${service.label} yet.`}</EmptyPage>;
}
