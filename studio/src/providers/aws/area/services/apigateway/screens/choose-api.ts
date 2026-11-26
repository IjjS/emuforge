import { createElement } from 'react';

import type { ServiceScreen } from '../../../screens';
import { servicePath } from '../format';
import { ChooseApiPage, type ApiChoiceDestination } from '../pages/choose-api-page';

const choices: readonly { name: string; segment: string; destination: ApiChoiceDestination }[] = [
  { name: 'Resources', segment: 'resources', destination: { model: 'rest', part: 'resources' } },
  { name: 'Stages', segment: 'stages', destination: { model: 'rest', part: 'stages' } },
  { name: 'Routes', segment: 'routes', destination: { model: 'v2', part: 'routes' } },
  { name: 'Integrations', segment: 'integrations', destination: { model: 'v2', part: 'integrations' } },
  { name: 'V2 stages', segment: 'v2-stages', destination: { model: 'v2', part: 'stages' } },
];

export const SCREENS: readonly ServiceScreen[] = choices.map(({ name, segment, destination }) => {
  const path = `${servicePath}/${segment}`;
  return {
    paths: [path],
    title: name,
    crumbs: [{ text: name }],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: path },
    Page: (props) => createElement(ChooseApiPage, { ...props, name, destination }),
  };
});
