import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';

import { AlarmActions } from './alarm-actions';

it('shows ARN text under its state and empty messages under the other states', () => {
  const arns = ['arn:aws:sns:us-east-1:000000000000:a', 'arn:aws:sns:us-east-1:000000000000:b'];
  const { container } = render(
    <AlarmActions alarm={{ type: 'metric', data: { AlarmActions: arns, OKActions: [] } }} />,
  );
  const items = createWrapper(container).findKeyValuePairs()?.findItems();
  const values = new Map(items?.map((item) => [item.findLabel()?.getElement().textContent, item.findValue()]));
  expect(
    values
      .get('In alarm')
      ?.findAll('.aws-area-value-address')
      .map((part) => part.getElement().textContent),
  ).toEqual(arns);
  expect(values.get('In alarm')?.findLink()).toBeNull();
  expect(values.get('OK')?.getElement().textContent).toBe('No actions');
  expect(values.get('Insufficient data')?.getElement().textContent).toBe('No actions');
});
