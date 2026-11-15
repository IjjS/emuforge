# Product

<!-- impeccable:product-schema 1 -->

Sources: the owner's answers of 2026-11-15 (issue #16), the owner's two-layer decision of the same day, and the
BRD's one-line definition, principles and MVP scope. Anything those do not confirm is listed as undecided below.

## Platform

web

## Users

Three primary audiences, all confirmed by the owner:

- **Application developers** whose code calls AWS. They check that code against the local emulator before they
  deploy.
- **IaC and infrastructure engineers.** They verify resources and IAM policies locally before they touch real AWS.
- **People learning AWS.** They practise without an AWS account and without cost.

Team use and CI use were offered and not chosen; they are not a primary audience.

The jobs a user does in Studio: see whether Studio reaches the engine and the emulator, and fix it when it does not;
go into a cloud provider's area and work there as in that provider's console.

## Product Purpose

EmuForge is a local workbench on top of AWS's official `aws-emulator`. It does not reimplement the emulator; it adds
a web console (EmuForge Studio), a CLI, IAM policy evaluation and IaC verification on top of it.

EmuForge is a multi-cloud local workbench. AWS is the first provider. Google Cloud and Azure are the planned
direction, not merely a possibility left open.

MVP success, as the BRD states it:

- Studio and the engine start with Docker Compose and are reached in a browser.
- The main create, read, update and delete operations of S3 and DynamoDB are verified by integration checks.
- Studio reconnects after the emulator restarts.
- A connection failure, a certificate error and an API the emulator does not implement are shown as different
  things.
- No request goes to a real AWS endpoint.

## Positioning

EmuForge stands on the official emulator rather than beside it: the emulator is called, never changed or
reimplemented, so what Studio shows is what the emulator really holds and really answers. It shows resources
created anywhere (Studio, the CLI, Terraform) and states plainly what the emulator does not support instead of
hiding or faking it. Everything runs locally; nothing reaches real AWS.

## Operating Context

- Runs on the user's own machine. The emulator runs separately (on a port the user names); the engine connects to
  it on loopback, and Studio talks only to the engine, never to the emulator and never to AWS.
- The emulator's keys and certificates change on every emulator start; the engine reads them again, and Studio
  reconnects.
- Users work alongside their own tools: application code, the AWS CLI, Terraform and other IaC, whose resources
  Studio shows as they are.
- Studio has two layers:
  - **Studio's own layer**: the parts only Studio has (its frame, home or dashboard, settings, connection status,
    and later the IAM simulation and Verify results). These are original and do not imitate any provider's console.
  - **The provider layer**: inside Studio's frame, each cloud provider's area follows that provider's console. AWS
    is the only provider today; its area follows the AWS console. Google Cloud and Azure, when added, follow their
    own consoles, not AWS's.

## Capabilities and Constraints

Confirmed MVP scope for Studio and the engine (BRD):

- Connect to a running emulator on a given port; read the keys and certificates again after a restart.
- Home: connection status, emulator version, endpoint, recent errors, and the engine process's own CPU and memory
  use (never the host's or other processes').
- AWS service screens that resemble the AWS console (Cloudscape): list, detail, create wizard, edit and delete.
  Resources made outside Studio appear as well. First targets: S3 and DynamoDB. The IAM console is built on the
  emulator's IAM API the same way as the other service screens.
- An HTTP 501 answer is shown clearly as "not implemented by the emulator".
- Destructive actions are confirmed. Light and dark mode.
- One Docker Compose start brings up Studio and the engine (and the emulator when needed).

Constraints (BRD principles and the owner's decisions):

- The emulator is not modified; EmuForge only calls an emulator started separately.
- The engine stays light; per-service logic does not accumulate in it.
- No request goes to real AWS, under any circumstance.
- What is and is not supported is never hidden; the emulator's `501 NotImplemented` is shown as it is.
- Start simple; add complexity when a real need appears.
- A provider's console style stays inside that provider's area, and Studio's own style does not restyle a provider
  area.

Terminology: **EmuForge** (the product), **EmuForge Studio** or **Studio** (the web console), **engine** (the local
server between Studio and the emulator), **provider** and **provider area** (a cloud provider and its part of
Studio).

Undecided:

- The order of AWS services after S3 and DynamoDB (SQS, Lambda, IAM is a proposal only).
- Which screens Google Cloud and Azure get, and when either is added.
- Team or CI use of Studio.
- An accessibility standard Studio is held to.
- Studio's voice and personality.

## Brand Commitments

The names "EmuForge" and "EmuForge Studio" are binding. No logo, colour or voice is binding.

## Evidence on Hand

- No logo or other brand asset exists.
- No customers, testimonials, case studies, benchmarks, pricing, licensing or press exist. Do not invent them.
- What EmuForge does is shown by its own checks against a real emulator (`tests/integration/`), not by claims.

## Product Principles

1. **Show the emulator as it is.** Real state from the real emulator, whoever created it; an unsupported operation
   is stated, never hidden or faked.
2. **Local and safe.** Nothing leaves the machine for real AWS; the only upstream is the local emulator.
3. **Studio's own, the provider's own.** Studio's own screens are Studio's; inside a provider's area the user works
   as in that provider's console, and neither layer leaks into the other.
4. **Built for more than one cloud.** AWS is the first provider, not the only one; adding a provider does not
   change Studio's own screens or another provider's area.
5. **Simple first.** Add complexity only when a real need appears.
