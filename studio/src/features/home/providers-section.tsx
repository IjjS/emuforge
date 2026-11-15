import './providers-section.css';

import { Link } from 'react-router';

import type { Provider } from '../../app/provider-list';
import { useLanguage } from '../../i18n/language-context';
import { ArrowIcon } from '../../ui/icons';
import { Panel, Section } from '../../ui/section';

/** One provider: its name linking to its area, how many services it has, and each service's link. */
function ProviderEntry({ provider }: { provider: Provider }) {
  const { plural } = useLanguage();
  return (
    <Panel className="st-provider">
      <div className="st-provider-head">
        <Link to={`/${provider.segment}`}>
          {provider.name}
          <ArrowIcon />
        </Link>
        <p>{plural('providers.services', provider.services.length)}</p>
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
  const { t, formatNumber } = useLanguage();
  // The counter has no word to inflect: a number of the current language in parentheses (requirement R5.4).
  return (
    <Section title={t('providers.title')} counter={`(${formatNumber(providers.length)})`}>
      {providers.map((provider) => (
        <ProviderEntry key={provider.segment} provider={provider} />
      ))}
    </Section>
  );
}
