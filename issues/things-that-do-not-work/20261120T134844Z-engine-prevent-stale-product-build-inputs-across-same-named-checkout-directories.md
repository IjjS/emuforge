Issue-Id: 621
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|product-build.context|same-basename-stale-input
Issue-Check-Ids:
Issue-Commit: 3a91f47e573fc870dc3014be0cbb736c82bd2b07

# Prevent stale product build inputs across same-named checkout directories

> Identified against commit `3a91f47e573fc870dc3014be0cbb736c82bd2b07`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Two local product-build contexts with the same directory basename can receive one another's source bytes before Cargo starts. With Buildx 0.33.0 and BuildKit 0.29.0, equal-size files at the same relative path and modification time reproduced this even when a different copied file forced the Rust stage to execute. A user building two same-named checkouts can receive an executable from the other checkout.

## Evidence

The whole check at the identified commit failed in engine.product-build-runs-current-worktree-code. The expected CLI marker began with 88c94d74 and the image printed 4599e394. The independent diagnostic captured different host SHA-256 values, the first source hash inside the second build step before Cargo, and identical hashes of the target and exported executable. See issue 594 worker evidence at emuforge-594-e1/output/trace-594/findings.md and basename/trace-b-build.log. Changing only the context basename delivered the correct source in basename/trace-c-build.log.

## Steps to Reproduce

Build the product from two different parent directories with the same final directory name. Give the same workspace file distinguishable, equal-length CLI markers and the same old modification time. Change a separate harmless copied input between invocations to force the Rust instruction to execute. Compare the host source hash to the source hash immediately after the engine COPY, then run the resulting image.

## Expected

The second build consumes the source bytes in its supplied checkout and runs its own CLI marker. Build input identity remains correct across the supported product build entry points.

## Out of scope

Cargo target invalidation and dependency reuse inside the build stage are covered by issue 594.
