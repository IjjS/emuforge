Issue-Id: 42
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|i18n.notice-no-engine-answer|origin-jargon
Issue-Check-Ids:
Issue-Commit: e1dc41c7c596aea2ef471a17fb3ee772417c0cdb

# Say what "another Studio origin" means in plain words in the engine-unreachable notice

> Identified against commit `e1dc41c7c596aea2ef471a17fb3ee772417c0cdb`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Home's notice "Studio cannot reach the engine" ends "…or it was started for another Studio origin." "Origin" is
a web developer's term; a user who started the engine with the wrong `--studio-port` is not told that the port is
what differs. The Korean and Japanese catalogues carry the same term across ("오리진", "オリジン"). Issue #32
reworded the German text only ("für ein Studio unter einer anderen Adresse").

Reference: none; Studio's own text (`studio/AGENTS.md`, "Languages of Studio's own layer").

## Evidence

- `studio/src/i18n/messages/en.json:59` (`notice.noEngineAnswer`): "…or it was started for another Studio
  origin."
- `studio/src/i18n/messages/ko.json:57`: "다른 Studio 오리진용으로 시작되었습니다."
- `studio/src/i18n/messages/ja.json:57`: "別の Studio オリジン用に起動されています。"
- The `mock` critique of issue #32 (`review-mock.md`, P3): "origin" jargon remains where German lost it.

## Steps to Reproduce

1. Build and serve Studio without an engine and open `/`: the notice's first paragraph ends with "another Studio
   origin".

## Expected

- The English text of `notice.noEngineAnswer` says in plain words what differs (the address or port Studio is
  served on), and every other catalogue says the same in its own words, with the glossary kept true.
- The catalogue check passes.

## Out of scope

- A native review of the catalogues; the owner's to arrange.
