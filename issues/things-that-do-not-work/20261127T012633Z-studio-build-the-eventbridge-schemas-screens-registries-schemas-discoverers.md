Issue-Id: 678
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.schemas|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge Schemas screens: registries, schemas, discoverers

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entries of EventBridge Schemas under `/aws/events` lead to the area's page for an entry without a screen, and Studio has no SDK client of the `schemas` model. The emulator keeps registries, schemas with versions, and discoverers. Reference: the same requests sent straight to aws-emulator (the `schemas` model, 31 operations). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ schemas list-registries
   -> {"Registries":[{"RegistryArn":"arn:aws:schemas:us-east-1:000000000000:registry/aws.events","RegistryName":"aws.events","Tags":{}}]}
$ schemas create-registry --registry-name p75-reg --description mine
   -> {"Description":"mine","RegistryArn":"…:registry/p75-reg","RegistryName":"p75-reg","Tags":{}}
$ schemas create-schema --registry-name p75-reg --schema-name p75-schema --type OpenApi3 --content {…}
   -> {… "SchemaArn":"arn:aws:schemas:us-east-1:000000000000:schema/p75-reg/p75-schema" …}
$ schemas describe-schema … --query [SchemaName,SchemaVersion,Type]
   -> ["p75-schema","1","OpenApi3"]
$ schemas search-schemas --registry-name p75-reg --keywords Event
   -> {"Schemas":[]}
$ schemas export-schema --registry-name p75-reg --schema-name p75-schema --type JSONSchemaDraft4
   -> ForbiddenException: You cannot export non discovered or non aws managed schemas.
$ schemas create-discoverer --source-arn arn:aws:events:us-east-1:000000000000:event-bus/p75e --description d
   -> {"Description":"d","DiscovererArn":"…:discoverer/events-event-bus-p75e","DiscovererId":"events-event-bus-p75e",…}
$ schemas describe-code-binding … --language Python36
   -> NotFoundException: Code bindings for schema with name p75-schema and version 1 language Python36 not found.
Whether a discoverer writes a schema for an event put on its bus was not observed.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Schema registries", "Schemas" or "Discoverers" in the navigation.
3. The page says there is no screen yet.

## Expected
- Registries are listed (`aws.events` included), made, described and deleted; a registry's schemas are listed, a schema is made, shown with its versions and content, changed and deleted.
- Discoverers are listed, made for an event bus chosen from the emulator's, started, stopped and deleted; the requirement first finds whether a discoverer writes schemas and the screens claim no more than that.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Code bindings, until the emulator is seen to produce one. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
