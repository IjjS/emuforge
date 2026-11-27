Issue-Id: 674
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.connection|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge connection and API destination screens

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entries "Connections" and "API destinations" of EventBridge lead to the area's page for an entry without a screen. The emulator keeps both. Reference: the same requests sent straight to aws-emulator (`CreateConnection`, `ListConnections`, `DescribeConnection`, `DeauthorizeConnection`, `CreateApiDestination`, `ListApiDestinations`, `DescribeApiDestination`, and their update and delete). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ events create-connection --name p75-conn --authorization-type API_KEY --auth-parameters ApiKeyAuthParameters={ApiKeyName=x-key,ApiKeyValue=…}
   -> {"ConnectionArn":"arn:aws:events:us-east-1:000000000000:connection/p75-conn/18ebc009-…","ConnectionState":"AUTHORIZED",…}
$ events list-connections
   -> {"Connections":[{"ConnectionArn":"…","Name":"p75-conn","ConnectionState":"AUTHORIZED",…}]}
$ events create-api-destination --name p75-dest --connection-arn … --invocation-endpoint https://example.com/hook --http-method POST
   -> {"ApiDestinationArn":"arn:aws:events:us-east-1:000000000000:api-destination/p75-dest/18ebc00a-…","ApiDestinationState":"ACTIVE",…}
$ events deauthorize-connection --name p75-conn
   -> {"ConnectionArn":"…","ConnectionState":"DEAUTHORIZING",…}
Whether a rule whose target is an API destination makes the HTTP call was not observed.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Connections" or "API destinations" in the navigation.
3. The page says there is no screen yet.

## Expected
- Connections are listed, made (each authorization type the emulator accepts), described, deauthorized and deleted; a secret is entered and never shown again or kept by the browser.
- API destinations are listed, made on a connection chosen from the emulator's, described, changed and deleted.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
An API destination as a kind of rule target, until its delivery is observed. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
