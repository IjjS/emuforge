Issue-Id: 34
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|packaging|compose-product-run
Issue-Check-Ids:
Issue-Commit: c07d3006627d385f454897f665ff1cf54ce0c66e

# Run EmuForge as a product with one Compose command and say how in the README

> Identified against commit `c07d3006627d385f454897f665ff1cf54ce0c66e`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

There is no way to run EmuForge as a product. What exists is a developer's start: build the engine with Cargo,
build Studio with bun, and run each from its own terminal with the emulator already up. The owner cannot look at
what `main` holds without doing those builds by hand, and nobody outside the repository could run it at all. The
`README.md` describes the layout and how to start the emulator, and nothing about installing or running EmuForge.

The BRD names this as part of the MVP (`docs/BRD.md` 5.1: one Docker Compose start brings up Studio and the
engine, and the emulator when needed; "started with Compose and reached in a browser" is the first MVP
criterion).

What is asked for:

- One command, from a clone, that builds the images and starts EmuForge (the engine and Studio), reached in a
  browser. No Rust, bun or Node on the host; Docker only.
- Two ways to start it, because some users already run an aws-emulator and some do not:
  - with an emulator that is already running on a port the user names;
  - with no emulator: the same command also starts one.
- A `README.md` that tells a new user how to start, by situation. The owner lists six; this issue writes the
  two that can exist now and says plainly that the other four are not available yet:
  1. (later, by version tag) installed with a shell command, emulator already running: issue #35;
  2. (later, by version tag) installed with a shell command, no emulator: issue #35;
  3. from a clone with Docker, emulator already running: this issue;
  4. from a clone with Docker, no emulator: this issue;
  5. (later, when the CLI exists) the CLI downloaded, emulator already running;
  6. (later, when the CLI exists) the CLI downloaded, no emulator.
  The developer's start (build and run each part by hand) is kept as its own section, apart from these.

Reference: none for the packaging. The emulator's own Compose file (`infra/aws-emulator/docker-compose.yml`) is
the pattern for ports and names.

Open points the plan settles or puts to the owner at the requirement stage:

- How Studio is served in the product form. Today `studio/scripts/serve.ts` serves `dist/` with bun on
  127.0.0.1, and the engine accepts browsers only from the Studio origin `http://127.0.0.1:<studio port>` and
  never listens on that port (`engine/AGENTS.md`).
- How a container reaches the emulator and its files. The engine reaches the emulator at
  `https://127.0.0.1:<port>` and reads its key and certificate under `~/.aws/emulator/<port>/` on every request
  path that needs them; the emulator's certificate is issued for that address. A container has its own
  loopback.
- What is published and where. Every port stays on 127.0.0.1 (root `AGENTS.md`, Safety); the emulator's key and
  certificate are mounted read-only and never copied into an image.
- One image or two, and whether the emulator's Compose file is included or referenced.

## Evidence

```
$ find . -name "Dockerfile*" -not -path "*/node_modules/*" -not -path "./.pm/*" -not -path "./output/*"
./infra/aws-emulator/Dockerfile
$ find . -name "docker-compose*.yml" -not -path "*/node_modules/*" -not -path "./.pm/*"
./infra/aws-emulator/docker-compose.yml
$ grep -n "^## " README.md
7:## Layout
17:## Run the emulator
28:## License
```

The only image and the only Compose file are the emulator's. The README has no section on running EmuForge.

## Steps to Reproduce

1. Clone the repository on a machine with Docker and without Rust or bun.
2. Look for a way to start EmuForge: `README.md` gives none, and there is no Compose file or image for the
   engine or Studio.

## Expected

- From a clone, one documented command builds and starts EmuForge against an emulator that is already running
  on a named port, and Studio opens in a browser at a loopback address and shows "Connected" for the engine and
  the emulator.
- From a clone, one documented command does the same and also starts an emulator, for a user who has none.
- Stopping is one documented command and leaves nothing running; an emulator the user started themselves is
  never stopped, restarted or recreated by EmuForge's commands.
- After the emulator restarts (new key and certificate), the running EmuForge reconnects without being
  restarted.
- Nothing is published beyond 127.0.0.1, no request leaves the machine, the emulator's key and certificate are
  in no image layer and no log, and TLS to the emulator is verified against its `ca.pem`.
- A check starts the product form from the repository and verifies the above against a real emulator.
- `README.md` has a "Start" part with the six situations: 3 and 4 with their commands, 1, 2, 5 and 6 marked as
  not available yet with one line each on what they will be; and a separate part for developing (the build and
  run by hand that exists today), with the ports and how to change them.

## Out of scope

- Version tags, published images, the shell installer and a rolling build of `main`: issue #35.
- The CLI and its install (situations 5 and 6).
- Persistence of emulator state, sign-in, and anything that makes EmuForge reachable from another machine.
- Running without Docker other than the developer's start.
