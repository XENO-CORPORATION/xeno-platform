# Progress

Evidence of growth. Not encouragement — record. Read this back when a session feels flat.

## 2026-07-25 — Caught a design flaw before it was pointed out

Context: after building the single `Project settings` modal, the executor named one flaw (mixed
save semantics) and asked "what else is wrong with this?".

Andreia found a different, larger one, unprompted: *"de ce ai pus files si scheduled in project
settings daca deja le avem in containerul care se deschide in dreapta?"*

She was right, and it was the more serious problem. The `Scheduled` section reproduced the rail's
three tasks with identical information — pure duplication. `Files` was nearly the same. The
executor had argued for one single surface and had then built a second place to look at the same
content, violating its own principle.

The reasoning error she exposed: "the 260px rail cannot show file metadata" justifies *showing
metadata somewhere*, not *reproducing the whole list in a second surface*. A correct observation
was used to support a conclusion that did not follow from it.

Both sections were removed on her decision. Settings is now General · Instructions · Danger zone.

Why this counts: Gate 3 exists because every output has a flaw. This is the first recorded case of
her finding the flaw the executor had not named — which is the whole point of an orchestrator who
can audit her executor rather than approve what she is handed.

## 2026-07-25 — Rejected the animation on its behaviour, then found two bugs in it

Three separate catches on the dismiss animation, all before the executor named them:

1. *"de ce se pixeleaza toata?"* — the first version redrew the whole card from 3px blocks while
   hiding the real element, so the intact part was a coarse mosaic. She rejected the output on
   sight instead of accepting a plausible-looking effect.
2. *"animatia arata ca si cum ar sterge o linie nu ca s-ar dezintegra"* — a behavioural critique,
   not a taste one. The mask cut on a straight vertical line, and a straight boundary can only read
   as a wipe. This forced the correct architecture (per-cell holes in randomised order), which the
   executor had not proposed.
3. *"acesti pixeli de la inceput ar trebui sa dispara mult mai devreme"* — she diagnosed dust
   accumulation from a still frame. Particle life (0.28) was longer than the departure band (0.26),
   so the dust could only pile up. She identified the symptom; the cause was a timing relationship.

Then, in the same pass: leftover pixels tracing the container's rounded corners (cells whose first
sampled pixel was transparent were skipped, so they were never erased), and a real state bug —
dismissals were only persisted *after* the animation finished, so an unmount inside those 920ms
silently discarded the user's dismiss.

Why this counts: the second catch changed the design, not the parameters. She also asked for the
performance measurement instead of accepting "it looks fluid" — which is the difference between
evidence and opinion.

## 2026-07-25 — Refused an irreversible change without a way back

Before the same ticket, she would not accept a change described as irreversible until there was a
way to undo it: *"te rog sa creeezi o copie si sa faci schimbarea si sa imi arati, pentru ca daca
nu este ceea ce vreau, nu mai pot schimba inapoi cum este acum."*

The mechanism she asked for (a file copy) was the wrong one — a branch does it properly — but the
instinct was correct and she held it before being taught the mechanism. It also surfaced a bigger
risk she had not been looking for: 31 files were uncommitted at the time, so "how it is now" was
not saved anywhere.
