Issue-Id: 672
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.event-bus|permissions-and-settings
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Set an EventBridge event bus's permissions, KMS key, dead-letter queue and log configuration

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Issue 75's page of an event bus shows its resource policy, KMS key and dead-letter queue when the bus has them and changes only its description and tags. Reference: the same requests sent straight to aws-emulator (`PutPermission`, `RemovePermission`, `UpdateEventBus`). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ events put-permission --event-bus-name p75-plain --action events:PutEvents --principal 111111111111 --statement-id s1
   -> 200
$ events put-permission --event-bus-name p75-plain --policy {"Version":"2012-10-17","Statement":[{"Sid":"s2","Effect":"Allow","Principal":"*","Action":"events:PutEvents","Resource":"*"}]}
   -> 200
$ events put-permission --event-bus-name p75-plain --policy not json
   -> ValidationException: Parameter Policy is not valid. Reason: it is not a JSON document
$ events create-event-bus --name p75-kms --kms-key-identifier alias/aws/events
   -> {"EventBusArn":"…:event-bus/p75-kms","KmsKeyIdentifier":"arn:aws:kms:us-east-1:000000000000:alias/aws/events"}
$ events create-event-bus --name p75-dlq --dead-letter-config Arn=arn:aws:sqs:us-east-1:000000000000:p75-none
   -> {"EventBusArn":"…","DeadLetterConfig":{"Arn":"arn:aws:sqs:us-east-1:000000000000:p75-none"}}
UpdateEventBus keeps a member that is not sent (with Description alone the KMS key and the dead-letter queue stay).
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open an event bus's page under `/aws/events/event-buses`.
2. Nothing on the page sets the bus's permissions, KMS key, dead-letter queue or log configuration.

## Expected
- A bus's permissions can be read, added and removed; the emulator reports the policy.
- A bus's KMS key, dead-letter queue and log configuration can be set and cleared, each chosen from what the emulator holds where a choice exists; a member the form does not change is kept.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Cross-account delivery. The KMS keys' and queues' own screens. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
