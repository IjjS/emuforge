Issue-Id: 675
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.endpoint|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge global endpoint and partner event source screens, or say what the emulator lacks

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entries "Global endpoints" and "Partner event sources" of EventBridge lead to the area's page for an entry without a screen. The emulator lists both and the probe could make neither. Reference: the same requests sent straight to aws-emulator (`CreateEndpoint`, `ListEndpoints`, `ListEventSources`, `ListPartnerEventSources`). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ events create-endpoint --name p75-ep --routing-config FailoverConfig={Primary={HealthCheck=arn:aws:route53:::healthcheck/00000000-…},Secondary={Route=us-west-2}} --event-buses …
   -> ValidationException: A health check with ARN arn:aws:route53:::healthcheck/00000000-0000-0000-0000-000000000000 does not exist.
$ events list-endpoints
   -> {"Endpoints":[]}
$ events list-event-sources
   -> {"EventSources":[]}
$ events create-partner-event-source --name aws.partner/example.com/p75/src --account 000000000000
   -> ValidationException: Caller is not whitelisted for the event source partner namespace aws.partner/example.com
An endpoint with a health check that exists was not tried.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Global endpoints" or "Partner event sources" in the navigation.
3. The page says there is no screen yet.

## Expected
- The requirement first makes a Route 53 health check in the emulator and calls `CreateEndpoint` with it; if an endpoint can be made, endpoints are listed, made, described and deleted.
- Partner event sources: the list is shown if the emulator can hold one; if none can ever exist locally the entry says so in the area's own words instead of an empty screen.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Route 53 health checks' own screens. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
