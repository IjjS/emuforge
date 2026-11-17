Issue-Id: 379
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|subscriptions
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS subscription screens: the Subscriptions list, a subscription's page, create, edit, delete, request and confirm

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation entry "Subscriptions" has no screen in Studio (`/aws/sns/subscriptions` shows the area's "no screen yet" page). A topic's page (issue 78) lists the topic's subscriptions and carries the console's five actions on them ("Edit", "Delete", "Request confirmation", "Confirm subscription", "Create subscription"), but each only leads to a route that shows "no screen yet": `/aws/sns/subscription/<arn>`, `…/edit`, `…/delete`, `/aws/sns/topic/<arn>/create-subscription`, `…/request-confirmation`, `…/confirm-subscription`. The emulator holds subscriptions and answers every operation on them. In the console "Delete", "Request confirmation" and "Confirm subscription" are dialogs, not screens: this issue builds them as dialogs on the topic's table and on the Subscriptions list and removes their three routes.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns subscribe --topic-arn <topic> --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:q   -> 200, a SubscriptionArn that ends with an id
$ aws sns subscribe --protocol email | email-json | http | https   -> 200, SubscriptionArn "PendingConfirmation"
$ aws sns subscribe --protocol sms | lambda | firehose | application   -> 200, a SubscriptionArn
$ aws sns list-subscriptions / list-subscriptions-by-topic   -> 200, 100 a page, NextToken "100", in the order they were made
$ aws sns get-subscription-attributes / set-subscription-attributes   -> 200
$ aws sns confirm-subscription   -> answered (a 4xx of its own for a made-up token)
$ aws sns unsubscribe   -> 200
$ aws sns delete-topic of a topic with 103 subscriptions   -> 200, list-subscriptions then holds none of them
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and create a topic with the AWS CLI.
2. Open `/aws/sns/topics` and the topic's page.
3. Subscribe a queue's ARN to the topic with the AWS CLI and reload: the subscription is a row of the topic's table.
4. Select the row and choose "Edit", or open `/aws/sns/subscriptions`: the page says there is no screen yet.

## Expected
- `/aws/sns/subscriptions` lists the emulator's subscriptions (ID, Endpoint, Status, Protocol, Topic; capture `04-subscriptions`), with paging by the emulator's own token; the side navigation gets the entry "Subscriptions".
- A subscription has its page; one can be created (protocol, endpoint, and the attributes the emulator stores: filter policy, redrive policy, raw message delivery), edited and deleted, and the emulator's answer, a refusal included, is shown.
- "Request confirmation" and "Confirm subscription" do what the emulator answers for them; the requirement finds out where a confirmation token of the emulator can be read, if anywhere.
- The five actions of a topic's table act instead of leading to a route.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Whether the emulator delivers a message to a subscriber (the publish issue). Mobile push endpoints. Any engine change. Anything sent to real AWS.
