# Meadow and Cabinet visual system

Status: Accepted H1 product direction; state-set and comprehension testing remain implementation work
Date: 2026-08-25
Decision owner: Kyle

## Direction

Slow Garden has two views of the same garden, not two products and not a personality setting.

- **Meadow** is the quiet, spacious posture for capturing, arranging, wandering, and noticing. It keeps evidence collapsed and lets the garden feel alive.
- **Cabinet** is the deliberate posture for inspecting a selected bloom, its source clippings, uncertainty, correction history, and provenance.

The distinction is functional: Meadow optimizes breadth and continuation; Cabinet optimizes depth and judgment. A user can prefer one view, but the product does not classify people into “visual” or “analytical” types.

## Shared object, different disclosure

```text
user source revisions
        |
        v
Meadow: living garden + selected flower
        |
        | Review clipping
        v
Cabinet: same bloom pressed + exact source clippings
        |
        | Keep / Correct / Prune
        v
same bloom lifecycle and provenance record
        |
        | Return to meadow
        v
Meadow reflects the response without changing sources
```

Switching views changes presentation and disclosure density only. It never creates a copy, changes evidence, reruns AI, promotes knowledge, or alters pass state.

## Meadow contract

### Primary job

Give unfinished thought open space. Capture and arrangement remain useful when no pass has run and no bloom exists.

### Visible structure

- Open sky and grass field with readable, anchored source-seed slips.
- Sparse wind paths for user-authored or explicitly accepted relationships.
- Living flowers for returned blooms. A flower can be noticed, focused, or selected without opening a report automatically.
- One concise derived label and interpretation when a flower is selected.
- Compact provenance count such as “3 source revisions.”
- One route into depth: “Review clipping.”
- Shared top bar with garden title, Meadow/Cabinet view control, Add seed, and next-pass status.

### Disclosure rule

Meadow shows enough evidence to establish that a bloom is sourced, but not the full evidence stack. It never hides the derived label. Keep, Correct, and Prune live in Cabinet so review does not crowd quiet capture.

### Flower grammar

Each reviewable bloom has one stable botanical identity that persists across Meadow and Cabinet. Different flowers create recognition and a sense of a growing garden. Species, size, color, growth, and motion do not encode confidence, mood, diagnosis, importance, or engagement value.

Bloom kind—connection, tension, change, or question—always appears in text and accessible naming. A later comprehension study may test a redundant shape convention, but no hidden flower taxonomy enters H1.

### Density

- At most three new flowers arrive from one pass.
- Historical flowers remain discoverable without all being fully rendered at once.
- Selected flower and active source seed receive focus; atmospheric flora cannot compete with editable text.
- At high density, use neighborhoods, depth, and viewport culling rather than shrinking notes or filling the field with decorative blooms.

## Cabinet contract

### Primary job

Answer “Why did this appear?” and let the user judge it without turning the product into a dashboard or report feed.

### Visible structure

- Warm botanical archive surface using the same typography, labels, accent colors, and top bar as Meadow.
- Selected living flower becomes the same pressed specimen; identity must be obvious without animation.
- Interpretation and derived class remain adjacent to the specimen.
- Exact user-authored source clippings show excerpt, revision/date, and source type.
- Fine connectors make claim-to-evidence relationships inspectable.
- Provenance count and revision tabs expose lineage without blending it into the interpretation.
- Keep, Correct, and Prune are the primary review actions.
- “Return to meadow” restores the prior field position and selection.

### Folder structure

The folder rail organizes gardens or explicitly created collections. It is contextual, collapsible, and secondary. It cannot become a project dashboard, task navigation, or duplicate knowledge hierarchy. A bloom appears once in its owning garden; Cabinet views do not create filing copies.

### Evidence hierarchy

1. concise interpretation and derived label;
2. exact supporting clippings;
3. contradictions and uncertainty when present;
4. revision history and technical provenance on demand;
5. correction controls and visible recurrence rule.

Cabinet may show more detail than Meadow, but the first view remains bounded to one bloom and its direct evidence.

## Transition grammar

- Selecting “Review clipping” preserves garden, bloom ID, source revision IDs, viewport neighborhood, and return focus.
- In full motion, the living flower may gather, flatten, and settle as a pressed specimen while source slips collect into clippings.
- Reduced motion uses a direct crossfade with the same flower silhouette, label, and bloom title already visible in the destination.
- Browser Back and “Return to meadow” restore the previous Meadow state rather than opening a fresh garden.
- Deep links may open Cabinet directly; “Return to meadow” then opens the owning garden around the bloom.

The transition communicates a change from exploration to inspection. It must not imply that the flower was picked, killed, finalized, or accepted.

## Responsive behavior

### iPhone

- Meadow becomes a vertically navigable garden neighborhood with focused seeds and flowers rather than a miniature infinite field.
- Selecting a flower opens Cabinet as a full-screen review route.
- Cabinet stacks specimen, interpretation, evidence clippings, and actions in that order.
- Return preserves scroll/focus position.

### Keyboard and screen reader

- Meadow exposes a structured garden list parallel to the spatial surface.
- Flowers have accessible names such as “Possible connection, 3 sources, new.” Species is decorative metadata.
- View switching, Review clipping, provenance, and every response are keyboard reachable.
- Focus moves to the Cabinet heading on entry and returns to the originating flower on exit.

## Shared tokens before implementation

- One wordmark, top bar, view control, garden title treatment, and action language.
- Humanist serif for reflective source/interpretation text; precise sans for labels, state, and evidence metadata.
- Botanical green for product chrome, cornflower blue for source/evidence cues, restrained coral for derived attention, warm ivory for review surfaces, pale cyan/field greens for Meadow atmosphere.
- Source and derived states use explicit words and different material/shape conventions; color only reinforces them.
- Paper edges and botanical specimens remain restrained enough that long-term use does not become scrapbook decoration.

## Refined generation receipt

Generated as a matched pair on 2026-08-25 using the original Meadow, Pressed Botanical, and inspected Flower moodboard references:

- Meadow refinement: `/Users/kylematthies/.codex/generated_images/01a0372f-7e6f-7e23-af8e-01ed5c5c9dfb/exec-c13a2aea-5a02-458e-adce-9d39f9574cba.png`
- Cabinet refinement: `/Users/kylematthies/.codex/generated_images/01a0372f-7e6f-7e23-af8e-01ed5c5c9dfb/exec-5160428f-c93f-4f17-9b4b-ce8f96def63a.png`

These frames establish the paired visual target. They are not final production assets.

## Known corrections for the state-set pass

- Meadow still uses more paper surface than the long-term 25/100-seed state may tolerate; density frames must reduce persistent note area without harming capture.
- Atmospheric grass cannot lower text contrast or become the primary semantic layer.
- Cabinet’s folder rail must collapse and remain garden-only; test the screen without it on iPhone.
- Cabinet uncertainty must cite why uncertainty exists rather than adding generic caution text.
- Keep/Correct/Prune should remain visually quiet until the bloom is ready for judgment.
- Literal botanical imagery must not imply emotional category, score, or scientific authority.

## Acceptance evidence still required

The implementation target is ready, but D1 completes only after matching Garden, Return Reveal, Bloom Detail, 5/25/100-seed, iPhone, reduced-motion, keyboard-focus, and large-text frames exist. In comprehension testing, every participant must distinguish source from system material, and at least 80% must find exact provenance without instruction.

