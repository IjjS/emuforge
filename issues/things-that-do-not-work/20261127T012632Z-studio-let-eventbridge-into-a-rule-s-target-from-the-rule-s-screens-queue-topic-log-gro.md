Issue-Id: 671
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.target|let-eventbridge-in
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Let EventBridge into a rule's target from the rule's screens: queue, topic, log group, function

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The emulator delivers an event to a rule's target only when the target lets `events.amazonaws.com` in. Issue 75's screens say so where a target is chosen and change no policy, so a rule made in Studio on a new queue routes nothing until the developer sets the policy with another tool. A Lambda function is not offered as a kind of target at all: its delivery could not be observed. Reference: the same requests sent straight to aws-emulator (`sqs:SetQueueAttributes`, `sns:SetTopicAttributes`, `logs:PutResourcePolicy`, `lambda:AddPermission`). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
A queue without a policy: PutEvents answers 200 with an EventId and the queue receives nothing.
$ sqs set-queue-attributes … Policy={"Statement":[{"Effect":"Allow","Principal":{"Service":"events.amazonaws.com"},"Action":"sqs:SendMessage",…}]}
   then the same event is delivered within two seconds; a condition on aws:SourceArn is honoured (the rule's own ARN delivers, another rule's does not);
   a policy for another service or for the account alone delivers nothing.
$ sns set-topic-attributes --topic-arn arn:aws:sns:us-east-1:000000000000:p75-topic --attribute-name Policy --attribute-value {… "Service":"events.amazonaws.com" … "sns:Publish" …}
   -> 200; the topic's subscriber then receives the event.
$ lambda add-permission --function-name p75-fn --statement-id p75-events --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:us-east-1:000000000000:rule/p75-rfn
   -> 200, the statement; no invocation of the function by a matching event could be observed afterwards.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator; make a queue with no policy.
2. Create a rule on an event bus with that queue as its target, and send a matching event from Send events.
3. The emulator accepts the event and the queue receives nothing; no screen offers to let EventBridge in.

## Expected
- From a rule's target the developer can see whether the target lets EventBridge in, and allow it: a queue's and a topic's policy, a Logs resource policy; the emulator then reports the policy, and what the target held of other statements is kept.
- The requirement probes Lambda delivery again; a function is offered as a kind of target only if the emulator is seen to invoke it, with its permission set the same way.
- After the change an event sent from Send events reaches the target.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Editing a policy as free text beyond the one statement EventBridge needs. The policies' own screens in SQS, SNS, CloudWatch Logs and Lambda. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
