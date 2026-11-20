# Engine test criteria

The scenarios that prove the requirement, written by the plan from the requirement and the design, before any code.
Read this at the `Test Criteria` stage of `references/workflow.md`.

## Two kinds of case

- **Unit**: runs with `cargo test`, no emulator, written by the unit's worker. Proves logic the engine owns:
  parsing, signing, header handling, policy evaluation, configuration, error mapping. Grouped per unit: they are the
  end condition its brief carries.
- **Integration**: a check under `/tests/integration` that runs against a real emulator, written by the plan after
  the build. Proves what only the whole path can show: that a request arrives, that the answer is the emulator's,
  that a restart is survived.

Put a case at the lowest level that can prove it. A rule that a unit test can prove is not repeated as an
integration check.

## Form

Group cases under one heading per target.

- `### Unit <unit> — <crate>::<module>` maps to one test module of that unit.
- `### Integration — <check id>` maps to one check. The id is `<module>.<slug>`, for example
  `engine.relay-s3-put-object-streams-body`.

Under a heading, a `Given` line is the shared context and each checkbox is one test:

```
- [ ] `<function, route or command>` When <condition> → Then <observable result>
```

- Write only the condition under test. Values that are not the subject stay unnamed.
- `Then` is something a caller can observe: a return value, a status and body, an exit code, a line of output,
  the state the emulator reports afterwards. Never an internal field.
- A failure case names the error the caller receives.
- Pair a success case with its failure case wherever an action can fail.
- For a `bug`, append `(regression)` to the case that reproduces the reported defect.
- For a `gap`, the integration check that showed the difference is listed first.
- A case waits for what it asserts (the line in the log, the answer, the state the emulator reports), with a
  bound; never for a neighbouring sign that it should be there by now. A port that accepts does not say that the
  line of its listener is in the log yet (issue 533).

Example:

```
### Unit e1 — emuforge_core::upstream
- Given an upstream URL from configuration
  - [ ] `Upstream::parse` When the host is 127.0.0.1 → Then it is accepted
  - [ ] `Upstream::parse` When the host is an amazonaws.com name → Then Error::UpstreamNotLoopback
  - [ ] `Upstream::parse` When the host is a name that resolves to loopback → Then Error::UpstreamNotLoopback

### Integration — engine.relay-survives-emulator-restart
- Given a bucket created through the engine
  - [ ] `PUT /<bucket>` When the emulator is restarted and the request is repeated → Then 200 without restarting the engine
```

Bad: `- [ ] relay works` — no target, no checkable result.
Bad: `- [ ] \`resign\` When called → Then self.cache is updated` — an internal field, not an observable result.

## Coverage

Eight axes. Each is accounted for in the checklist below whether or not it produces a case.

1. **Happy path**: every step of the requirement completes.
2. **Input and protocol**: each AWS wire protocol the change touches (JSON, REST-JSON, REST-XML, Query),
   empty and large bodies, streaming bodies, presigned URLs, malformed input.
3. **Caller identity**: Studio session, a signed request, an unsigned request, a wrong key; with IAM on:
   allow, explicit deny, implicit deny, a policy element the evaluator does not support.
4. **Upstream state**: emulator healthy, down, restarted with new keys, slow past the timeout, answering 501. An
   integration check of an environment case (the emulator or the engine stopped, killed, restarted, not there, not
   reachable, or coming up late) is written for the tier `full` and never for the push run or a whole check
   (`tests/integration/AGENTS.md`, Full tier); a unit test proves what it can without them.
5. **Boundaries**: zero, one and many; the exact size, time and concurrency limit and one past it.
6. **Repetition**: the same request twice, a retry after a timeout, a cancelled request.
7. **Transparency**: what the caller receives through the engine equals what the emulator sends directly
   (`references/relay-fidelity.md`).
8. **Safety**: no request leaves loopback, no secret appears in output or logs, nothing is read from or
   written to `~/.aws` outside `~/.aws/emulator/<port>/`.

## Coverage checklist

The test criteria always end with this fixed block. Check an axis once its cases are written; append
`(Not Scope)` to one the issue does not touch.

```
### Coverage
- [ ] Happy path
- [ ] Input and protocol
- [ ] Caller identity
- [ ] Upstream state
- [ ] Boundaries
- [ ] Repetition
- [ ] Transparency
- [ ] Safety
```

## Left out

The plan may leave an integration scenario out when the issue is too slight or the test would cost more than it
shows. It says so here, with the reason, when it can tell before the build, and in its `report.md` at the end. When
it cannot tell, it asks the `pm` (`lead.md`).
When the issue will make no integration changes, use the omission line specified by the PM skill's
`references/lead.md` in the plan set.

## Scope

- Derive cases only from the confirmed requirement and design. A case that cannot be decided from them is a
  question for the `pm`, not a rule to invent.
- Do not list a case whose failure would be the emulator's own gap. An operation the emulator answers with
  501 is asserted as 501 passed through, not as the operation working.
- No performance number unless the requirement set one.
- A test does not assert how many entries a list has when the list grows with the product (services, routes,
  catalogue entries); it asserts the property the number stood in for (each entry well formed, two lists equal, no
  entry twice by its key, the list not empty). A number that is the behaviour under test stays (a limit such as the
  32 targets).
