import './providers-section.css';

import { Link } from 'react-router';

import type { Provider } from '../../app/provider-list';
import { ArrowIcon } from '../../ui/icons';
import { Panel, Section } from '../../ui/section';

function servicesLine(count: number): string {
  return `${String(count)} ${count === 1 ? 'service' : 'services'} · no Studio screen yet`;
}

/** One provider: its name linking to its area, how many services it has, and each service's link. */
function ProviderEntry({ provider }: { provider: Provider }) {
  return (
    <Panel className="st-provider">
      <div className="st-provider-head">
        <Link to={`/${provider.segment}`}>
          {provider.name}
          <ArrowIcon />
        </Link>
        <p>{servicesLine(provider.services.length)}</p>
      </div>
      <ul className="st-services">
        {provider.services.map((service) => (
          <li key={service.path}>
            <Link to={service.path}>{service.label}</Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Home's "Providers" section (requirement R9.2): one entry per provider of the providers list, in its order. */
export function ProvidersSection({ providers }: { providers: readonly Provider[] }) {
  return (
    <Section title="Providers" counter={`(${String(providers.length)})`}>
      {providers.map((provider) => (
        <ProviderEntry key={provider.segment} provider={provider} />
      ))}
    </Section>
  );
}
