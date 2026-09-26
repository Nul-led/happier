# Copy

Voice and tone are in `DESIGN.md` → "Product copy and voice". This file is the mechanics.

## Mechanics

- Sentence case everywhere: titles, buttons, section headers, menu items.
- Titles are short nouns or noun phrases ("Recovery key", "Session defaults"). Buttons are verbs
  ("Copy", "Install", "Sign out of Personal Home").
- A description completes the title; it states the current value, the scope, or the consequence.
  One sentence, no trailing marketing.
- Name the scope when it matters: "How you sign in to Personal Home", "Used when a new session starts
  with Claude".
- Use the product's nouns: agent (not engine or backend), Home, machine, provider, session.
- Numbers and counts are specific ("312 models", "17 built-in · 2 custom").
- A choice between two named things is phrased as the choice ("Start with: Composer | Wizard"), not
  as a flag.
- Every string goes through `t(...)` in all locales.

## Smells and rewrites

| Smell | Example | Rewrite |
| --- | --- | --- |
| Mechanism instead of outcome | "Bounded, content-free observations" | Say what the user gets or allows, in their words |
| The same word in sibling items | "Sign in to find your Homes" / "Sign in to Homes" / "Sign in once…" | Each item says one distinct thing |
| Raw identifiers | `happier-repo-dev-….localhost:53288` | The name the user gave it; "this Home" when unnamed |
| Duplicated message | "Not available — This agent has no settings screen" twice | One title, one description, or one of them |
| Title restated in description | "Density — Choose the density" | State the effect: "How much fits on screen" |
| Uppercase or title-case headers | "SESSION LIST DENSITY" | "Session list density" |
| Explanatory footer after the rows | a grey paragraph under a group | Section description above the rows |
| Status in words for healthy things | "Everything is working" | Nothing; speak on trouble |
| Vague feature names | "Use your other devices" | The outcome: "Connect your phone and other devices to your Homes" |
| Error without a next step | "Operation failed" | What failed, why if known, and the action |

## Before shipping copy

- Read the screen top to bottom out loud. If two lines say the same thing, cut one.
- Check the longest locale and a 390px phone: nothing essential truncates mid-meaning.
- Check every state's copy, not just the populated one.
