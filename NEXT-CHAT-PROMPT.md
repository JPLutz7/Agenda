# Prompt for the next chat

Copy everything in the box below and paste it as the first message of a new
session. It is written for the app's owner to send as-is.

---

```
I'm Joao. You're picking up work on Agenda, the shared dorm calendar and
household app I built with you for me and my roommate Nino. Live at
https://agenda-nd.fly.dev, repo JPLutz7/Agenda, branch
claude/shared-roommate-calendar-0x23o9.

How to work with me:
- Always talk to me like I don't know how to code. Plain language, no jargon.
- I have no dev environment — my work computer is locked down. Never send me
  to a terminal. Everything ships by you pushing to that branch, which
  auto-deploys.
- Do the building, testing and verifying yourself, in a browser, and tell me
  honestly what passed and what didn't.

First thing: read HANDOFF.md in the repo. It has the full context — the
architecture, the traps that have bitten previous sessions, what the last bug
sweep already checked and cleared, and what's waiting on me rather than on
code. Read it before touching anything.

Then start a bug sweep of the app. Not a code review — actually run it and
use it, at iPhone size, in both Chromium and WebKit (WebKit is what mine and
Nino's phones run, and it has disagreed with Chrome before). Drive every
screen and every action: adding, editing and deleting events, chores and
shopping list items; all four calendar views; both list tabs; light, dark and
auto; real touch gestures, not synthetic ones. Check the things recent changes
could have broken in each other's areas, since each was verified on its own.

The last sweep was on 31 July and found the app functionally sound — don't
just repeat it. Start from what it covered, and give the newest work the
hardest look: the Amazon price reader's three outcomes (a price, an
unavailable product, a shop blocking us), the per-phone shopping list sort,
and the owner colours on ticked-off items and chores.

Report back in plain language: what you checked, what's actually broken, and
what only looks odd but is intentional. Fix what you find, push it, and
confirm the deploy went green. If you find something where you'd need my
decision rather than a fix, ask me.
```

---

## Why the prompt says what it says

Kept short on purpose — the detail lives in `HANDOFF.md`, which the prompt
points at, so this doesn't have to be re-edited every time something lands.
The four things it does carry are the ones a cold session can't infer:

- **who the owner is and how to talk to him** — no code, no terminal, ship by
  pushing;
- **that "verify" means driving the built app**, in WebKit as well as
  Chromium, because that has caught real bugs repeatedly and reading the code
  has not;
- **that a sweep already happened**, so the next one extends it instead of
  re-running it; and
- **where the newest, least-examined work is**, which is where a bug is most
  likely to be hiding.
