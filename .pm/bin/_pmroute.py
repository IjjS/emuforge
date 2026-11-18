"""Where pm-watchd delivers an EVENT line: to the pm, or to the plan that leads the issue the line is about. Not a
command.

An issue led by a plan hears its own panes through its plan (issue 478): a line about a worker, rev or crit pane of
issue <n>, or about a worktree of issue <n>, goes to the live pane `i<n>-plan` when there is one. Every other line
goes to the pm: the plan's own lines, a harness-engineer's, a dialog (`EVENT blocked`, which only the pm may answer),
a pane's `BLOCKED … memory`, `BLOCKED … cpu` and `BLOCKED … depends emulator image` (the machine's, which the pm
answers on EVENT mem ok, cpu ok and emulator-image), the machine's own (mem, cpu, tokens, orphans: the pm prompts the pane or sweeps), the owner's (go) and every
other kind. An issue with no live plan (one begun before
issue 478) is heard by the pm, as before. `EVENT room <pane> …` goes to the pane it names, the one a QUEUE answer
of pm-pane or a WAIT answer of pm-check told to wait; when that pane is gone, to nobody.
"""
import os
import re

PM = None  # the target that stands for the pm
TO_PLAN = ("ready", "gone", "stale", "ctx")  # kinds whose third word is the pane the line is about
LED = ("worker", "rev", "crit")  # the roles of the panes a plan opens and hears
MACHINE = re.compile(r"^BLOCKED \S+ (memory|cpu|depends emulator image)\b")  # a pane's line about the machine


def plan_of(issue, reg):
    """The name of the live plan pane of the issue, or None."""
    name = f"i{issue}-plan"
    return name if any(r.get("name") == name and not r.get("gone") for r in reg) else None


def route(line, reg, wts):
    """The target of one EVENT line: a pane name, PM (None) for the pm, or "" for nobody.

    reg is the pane registry (gone entries included: a gone pane's line is routed by what it was), wts the
    worktree registry."""
    words = line.split()
    if len(words) < 3 or words[0] != "EVENT":
        return PM
    kind, subject = words[1], words[2]
    if kind == "room":
        return subject if any(r.get("name") == subject and not r.get("gone") for r in reg) else ""
    if kind == "ready" and MACHINE.match(" ".join(words[3:])):
        return PM
    if kind in TO_PLAN:
        entry = next((r for r in reg if r.get("name") == subject), None)
        if entry and entry.get("role") in LED:
            return plan_of(entry.get("issue"), reg) or PM
        return PM
    if kind == "check" and subject == "still" and len(words) > 3:
        name = words[3]  # the worktree's registered name (_pmstill), or its path
        wt = next((w for w in wts if w.get("name") == name
                   or os.path.realpath(w.get("path", "")) == os.path.realpath(name)), None)
        if wt:
            return plan_of(wt.get("issue"), reg) or PM
    return PM
