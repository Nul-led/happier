# What makes a Happier surface feel premium

The rules in `SKILL.md` and `anatomy.md` keep a screen correct. This file covers why a screen feels
beautiful, coherent and alive instead of bland. It records what the user's favourite surfaces had in common:
the Home index, the phone-pairing expansion and the Channels empty state (2026-09-28). The specific ideas
belong to those screens. Take the principles below, not the ideas.

## 1. Give every surface one signature moment

A bland screen puts every element at the same weight. A premium one has **one moment that rewards
intent**: the thing you tapped becomes what you asked for, in place, without taking you anywhere. The
gesture of asking turns into the answer. Find the single most intentful action on the surface and make
that the moment. Build it from existing primitives. Spend the novelty on behaviour, not on new chrome.

## 2. Show the thing itself, not a link to it

Put the actual content on the surface: the code to scan, the latest runs, the needs-you item and its
button, the real usage bars. "Open X", "View details" and "Go to…" rows are a last resort. If a block only
navigates somewhere else, ask what the user wanted to see there and show a small, live slice of it here.

## 3. Make it feel alive and personal

- **Speak to the person.** A greeting, their names, their machines, their sessions.
- **Summarize the present in one quiet line** ("2 sessions working · 1 needs you").
- **Show what's happening now:** "Waiting for your phone…", a countdown to the next code, "As of 10:42",
  a working spinner on the one row that's working.

The interface should show that it knows the current state and is paying attention. Static labels and
generic headings ("Overview", "Items") read as dead.

## 4. Choose one clear hero and keep everything else quiet

- One large typographic anchor per surface: a title or greeting at display weight.
- Everything else steps down firmly: section titles, row titles, muted metadata.
- Colour carries meaning only: status, brand identity marks, the one primary action. The neutral base
  is what makes those few accents land.
- Raise elevation only on the object that is focused or expanded.

## 5. Keep one rhythm across the page

Blocks share the same column edges and widths: the composer is exactly as wide as the cards. Grids use
the same tile rhythm everywhere. Rows keep the owner's metrics, and every gap is the same step. Coherence
comes from repeating a small set of measures, not from adding decoration. When a block is visibly wider,
taller or looser than its neighbours, it reads as a mistake even if nobody can say why. Use empty space
deliberately: don't stretch a thin list across the full width; put it in a grid.

## 6. Empty states invite; they don't apologize

An empty state is a first impression, often the most-viewed frame of a new feature. Give it:
- **identity**: the marks of what it connects to, or its own symbol;
- **a one-sentence promise** of the value, in the user's terms ("Talk to your sessions from…");
- **one primary action**, plus a quiet "How it works".

Never write "No items", "Nothing here" or a sad illustration. Explain what the surface is for and how to
start. The same holds for loading, stale and error states: each one is designed with copy that names the
cause and a recovery action.

## 7. Write specific, honest, reassuring copy

- **Name the consequence and the reassurance:** "Nothing is deleted", "no account needed", "You can
  switch back any time".
- **Use the real nouns:** the machine's name, the Home's name, the plugin's name.
- **Describe what will happen**, not how the system works.
- **Let short helper lines do the teaching,** so no tutorial is needed.

## 8. Anticipate the next step

Premium surfaces answer "what now?" before it's asked: suggested actions that fit the user's current data,
a needs-you row with its button inline, a setup item that turns into the setup itself. Each block should
answer "what's happening" or "what can I do next". A block that answers neither probably shouldn't be
there.

## 9. Compare against best-in-class, then make it Happier

Before settling, hold the frame next to the best tools in the category (Apple's system apps, Linear,
Things, Raycast, Arc, the ChatGPT and Codex apps) and ask where ours looks flatter, busier or more
generic. Borrow the principle behind the difference, never the pixels. Then check it still reads as
Happier: calm, warm, fast (`DESIGN.md`).

## Self-check before calling it done

- [ ] What is this surface's signature moment? Does it transform in place?
- [ ] Does every block show real content or a real next step?
- [ ] Does the surface show the present: live status, time, who and what?
- [ ] Is there exactly one hero? Is colour used only for meaning?
- [ ] Do all blocks share edges, widths and rhythm? Is anything stretched thin?
- [ ] Do the empty, loading and error states each invite a next step, with honest copy?
- [ ] Held next to a best-in-class reference, what still looks bland, and why?
