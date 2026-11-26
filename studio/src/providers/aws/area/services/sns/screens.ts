import type { ScreenNavigation, ServiceScreen } from '../../screens';
import { CREATE_TOPIC_PATH, SNS_PATH, topicHref, topicName, TOPICS_PATH } from './format';
import { CREATE_SUBSCRIPTION_TITLE, CreateSubscriptionPage } from './pages/create-subscription-page';
import { CREATE_TOPIC_TITLE, CreateTopicPage } from './pages/create-topic-page';
import { TOPICS_TITLE, TopicListPage } from './pages/topic-list-page';
import { TopicPage } from './pages/topic-page';

/** SNS's side navigation on its screens (issue 536, requirement "Screens, routes, layer"): "SNS" and "Topics". */
export const NAVIGATION: ScreenNavigation = {
  header: { text: 'SNS', href: SNS_PATH },
  activeHref: TOPICS_PATH,
};

/** SNS's screens, which the area collects. A topic is addressed by its ARN as one segment, decoded once by the area. */
export const SCREENS: readonly ServiceScreen[] = [
  // S1, the topics (tasks 1, 5): at the service's route and at its own, neither redirecting.
  {
    paths: [SNS_PATH, TOPICS_PATH],
    title: TOPICS_TITLE,
    crumbs: [{ text: TOPICS_TITLE }],
    navigation: NAVIGATION,
    Page: TopicListPage,
  },
  // S2, "Create topic" (task 4).
  {
    paths: [CREATE_TOPIC_PATH],
    title: CREATE_TOPIC_TITLE,
    crumbs: [{ text: TOPICS_TITLE, href: TOPICS_PATH }, { text: CREATE_TOPIC_TITLE }],
    navigation: NAVIGATION,
    Page: CreateTopicPage,
  },
  // S3, a topic (tasks 1, 3, 5): its tabs by the query.
  {
    paths: [`${TOPICS_PATH}/topic/{arn}`],
    title: ({ arn }) => topicName(arn ?? ''),
    crumbs: ({ arn }) => [{ text: TOPICS_TITLE, href: TOPICS_PATH }, { text: topicName(arn ?? '') }],
    navigation: NAVIGATION,
    Page: TopicPage,
  },
  // S4, "Create subscription" (tasks 2, 6), below the topic.
  {
    paths: [`${TOPICS_PATH}/topic/{arn}/subscribe`],
    title: CREATE_SUBSCRIPTION_TITLE,
    crumbs: ({ arn }) => [
      { text: TOPICS_TITLE, href: TOPICS_PATH },
      { text: topicName(arn ?? ''), href: topicHref(arn ?? '') },
      { text: CREATE_SUBSCRIPTION_TITLE },
    ],
    navigation: NAVIGATION,
    Page: CreateSubscriptionPage,
  },
];
