import Header from '@cloudscape-design/components/header';

import type { ScreenPageProps } from '../../../screens';

// S4, "Create subscription" (issue 536, design tasks 2 and 6). A stand-in: unit s3 builds it.

/** The page's title, its `h1` and its last crumb. */
export const CREATE_SUBSCRIPTION_TITLE = 'Create subscription';

export function CreateSubscriptionPage(props: ScreenPageProps) {
  void props;
  return <Header variant="h1">{CREATE_SUBSCRIPTION_TITLE}</Header>;
}
