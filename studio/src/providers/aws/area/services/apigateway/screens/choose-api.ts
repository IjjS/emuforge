import { createElement } from 'react';

import type { ServiceScreen } from '../../../screens';
import { ENTRIES } from '../entries';
import { apiGatewayNavigation } from '../navigation';
import { ChooseApiPage } from '../pages/choose-api-page';

export const SCREENS: readonly ServiceScreen[] = ENTRIES.flatMap(({ name, path, chooseApi }) =>
  chooseApi === undefined
    ? []
    : [
        {
          paths: [path],
          title: name,
          crumbs: [{ text: name }],
          navigation: apiGatewayNavigation(path),
          Page: (props) => createElement(ChooseApiPage, { ...props, name, destination: chooseApi }),
        },
      ],
);
