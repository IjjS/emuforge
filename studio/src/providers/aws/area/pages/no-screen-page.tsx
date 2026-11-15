import type { Service } from '../../services';
import { EmptyPage } from '../components/empty-page';

/** `/aws/<service>` and every path below it, until the service has a screen. Calls nothing. */
export function NoScreenPage({ service }: { service: Service }) {
  return <EmptyPage title={service.label}>{`Studio has no screen for ${service.label} yet.`}</EmptyPage>;
}
