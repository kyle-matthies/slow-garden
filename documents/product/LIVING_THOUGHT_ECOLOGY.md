# Living thought ecology

Status: Accepted product direction; next-slice design brief
Date: 2026-09-06
Decision: D-018

## Product promise

Slow Garden is not a habit tracker, task manager, or chat interface disguised as a garden. It is a quiet, private place where a person can write a fragment, question, note, or developing idea and leave it alone. Later, they return to a page-like experience that has been gently tended: its context is preserved, its structure is clearer where useful, and one or two source-linked questions or observations may be ready.

The foreground remains the person's own thinking. The background is a deliberately delayed system that gets to know the material only within the permissions the person gives it.

## Vocabulary and hierarchy

| Object | Meaning | Can it be finished? |
| --- | --- | --- |
| Entry | One authored moment or revision of thought. | No; source revisions remain immutable. |
| Seed | A named, evolving thread built from entries and revisions. | No; it can rest, change, branch, or be revisited after a bloom. |
| Plot | A living user-defined area for related seeds. Examples may include a work question, creative project, personal season, or decision. | No; it becomes richer as related thought accumulates. |
| Garden | The user's wider private ecology of plots and permitted relationships. | No. |
| Bloom | A bounded, reviewable return: connection, tension, change, question, or synthesis. | No; it is a moment of coherence, not a completion state. |

The product may visualize maturity, density, or richness, but those signals must not masquerade as a score for mood, importance, certainty, productivity, or engagement.

## Connection and privacy model

Connection scope is explicit and inspectable:

1. **Isolated:** material remains available only to its seed or explicitly selected local context.
2. **Within plot:** the seed may inform connections with other seeds in the same plot.
3. **Across garden:** the seed or plot may participate in wider garden cross-pollination.

The plot supplies the default. A seed may narrow or broaden that permission. A visible explanation must say what scope will be included before a pass runs. The system never infers permission from semantic similarity, and no user content is shared with another tenant.

## Tending contract

The system may do quiet background work only after capture is complete. It can:

- retain and organize source context;
- identify potential relationships across permitted material;
- preserve uncertainty and exact evidence;
- return a small question, observation, or connection; and
- return nothing when the material is sparse, unchanged, unsupported, or not meaningfully connected.

It cannot rewrite a source as if it were the user, force an immediate reply, create a task, send a message, publish, or act outside the garden.

Human stewardship—not app frequency—drives the meaning of growth. Useful acts include adding context, revisiting, revising, connecting, correcting, or consciously letting a thought rest. AI output never causes a plant to grow by itself.

## Next implementation slice

Build only enough to test the core ritual on native iPad/iPhone:

1. Create a plot and plant a named seed.
2. Add or revise private entries without AI interruption.
3. Set the seed or plot connection scope.
4. Trigger one real delayed manual pass using the same durable asynchronous path planned for later scheduling.
5. Return to Meadow and receive either a small source-linked question/connection or a legitimate no-result.
6. Inspect the evidence and keep, correct, or prune the return in Cabinet.

Success is not a streak or daily-use metric. The question is whether returning makes the person's thinking feel more continuous, more legible, and more their own.

## Open design questions

- How should a user distinguish a seed that is resting from one that is actively developing without turning the garden into a status dashboard?
- What visual grammar can show plot richness and connectedness without encoding confidence, emotional state, or productivity?
- Should a plot's cross-pollination setting be exposed during creation, only before a pass, or both?
- What is the smallest helpful “grooming” action that feels like care rather than AI authorship?
- When a bloom appears, should it be attached to a seed, a relationship between seeds, or a plot-level area of the garden?
