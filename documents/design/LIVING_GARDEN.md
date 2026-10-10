# Living garden

Status: Accepted design direction, 2026-10-09 (D-022, [ADR-007](../architecture/ADR-007_LIVING_GARDEN_SCENE.md), [ADR-008](../architecture/ADR-008_TENDING_TIERS.md))
Owner: Kyle

The web garden becomes a living place. You move through it, plants grow as you tend
your thoughts, and returns arrive as flowers you can press into clippings. This spec
extends [Meadow and Cabinet](MEADOW_AND_CABINET.md) and activates the
[botanical scrapbook roadmap](BOTANICAL_SCRAPBOOK_ROADMAP.md).

## Concept mapping

| Data | In the scene |
|---|---|
| Garden | A whole meadow vista. Its light comes from its ID (dawn, morning, golden hour, dusk); dark mode uses night palettes. Gardens sit on a ring you rotate through. |
| Topic | A bed or clearing on an arc around the viewer. |
| Thought | One plant. Species, hue and form come from its ID and never change. |
| Entry | A paper slip in the person's serif hand. Slips drift forward when the plant is focused. |
| Bloom | A vellum tag tied to the plant it cites, naming its kind in words, with a soft glow while it is new. A bloom citing several plants is drawn as a thread between them. Blooms are tending material, never botanical growth. |
| Tending marks | Graphite-on-vellum field tags, coral wind threads, resurfaced slips and question notes. Each one carries a text label ("Tended", "Noticed", "Question from tending"). |

## Depth levels

1. **Ring** (`view=gardens`). Every garden is a small living diorama on a ring. The
   focused garden is in front and its neighbours recede. Drag, swipe or use ←/→ to
   rotate. Enter or a tap flies into the garden.
2. **Meadow** (default `/garden`). A panorama of one garden's beds. Rotating passes
   bed to bed with parallax: near grass moves faster than the far hills.
3. **Bed** (`topic=`). The camera moves closer to one bed and its plants become
   focusable.
4. **Plant focus** (`focus=`). The plant comes forward as a specimen and its latest
   slips drift in. Tending marks appear here, quietly. "Write" opens the page.
5. **Writing page** (`thought=`, unchanged deep links). A paper page rises over a
   blurred, completely still scene. The canvas, sway and drift all stop. The
   existing editor is used unchanged.
6. **Cabinet clipping**. A bloom's flower gathers, flattens and settles into a pressed
   specimen. Its source slips collect into deckled clippings joined by dashed
   provenance connectors.

`view=list` is today's structured workspace. It stays one tap away through the header
toggle, and the choice is remembered in this browser.

## Growth grammar

Growth reflects the person's stewardship of a thought, never AI output and never
frequency.

| Stage | Reached when (any order of writing) |
|---|---|
| Seed | Thought exists, no saved entry |
| Sprout | 1 entry |
| Leafing | 2 entries, 2 contributions (an entry revised once), or 2 distinct days |
| Budding | 3+ entries on 2+ distinct days, or 5+ contributions |
| Flowering | 5+ entries on 3+ distinct days, or 8+ contributions |

A contribution is an entry or a later revision of one. Flower count and side
stems keep growing gently with further contributions.

- Growth is monotonic. A thought never wilts, shrinks or decays when left alone.
- Recency is not encoded. A resting thought looks the same as one written today.
- Archive removes a plant from the scene; Restore returns it to its original slot.
- Flowers belong to the person: a thought flowers from its own tending, so a garden
  with AI off is still in bloom. Tending output never adds botanical growth; it
  arrives as vellum tags, threads, notes and resurfaced slips (see below).
  Implementation decision, 2026-10-10: the earlier draft reserved flowers for AI
  blooms, which would leave every no-AI garden without a single flower and blur the
  rule that AI never grows a plant.
- Size, colour, species and motion never encode mood, confidence, importance or
  engagement.

## Stable layout

- A plant's slot in its bed is derived from its ID. Collisions resolve by
  deterministic probing in creation order.
- Planting a new thought never moves an existing plant.
- When `position_x/position_y` exist on a seed, they win.
- There is no automatic rearrangement.

## Tending visual grammar

| Tending output | Surface | Words always shown |
|---|---|---|
| Theme label | Small vellum tag tied to the stem, in the graphite sans | "Tended · ⟨label⟩" |
| Open question (the person's own) | The person's sentence on an ivory slip, clipped by a tending tag | "Left open · your words" |
| Unfinished | Tag beside the last slip | "Tended · unfinished" |
| Pattern | Coral wind thread through the plants that share a theme | "Noticed · returned to ⟨label⟩ on ⟨n⟩ days since ⟨month⟩" |
| Connection, tension or change | Flower opens; thread between cited plants | "Possible connection", "Tension", "Change" |
| Echo | Older slip drifts forward beside the current plant, with a date gap | "Echo · ⟨n⟩ months apart" |
| Question | Small folded note tied to the stem | "Question from tending" |

Rules:

- Source material is ivory paper in the serif face. Derived material is vellum, uses
  the sans face, and carries the `❦` mark plus words. Colour is never the only cue.
- Tending marks never appear on the writing page or inside the editor.
- A garden with no tending yet looks complete and calm. There are no empty slots and
  no "waiting for AI" states.
- The ring may show a single small vellum tag on a garden that has unseen tending. It
  shows no counts, badges or urgency.

## Motion storyboard and reduced-motion mapping

| Moment | Full motion | Reduced motion |
|---|---|---|
| Rotate ring/meadow | Spring camera pan with layered parallax, ~600 ms | Crossfade to the new bed/garden, 150 ms |
| Enter garden | Ring diorama scales up into the meadow | Crossfade |
| Focus plant | Plant rises and scales; slips drift in on staggered springs | Plant and slips appear in place |
| Wind | Grass bends in a noise field; plants sway 1–3° in a gust that travels across the meadow (compositor-only CSS, phased by each plant's place); pollen drifts | One static frame, no sway |
| Growth change | Stem lengthens and leaves unfurl over ~1.2 s, after saving and returning | New stage shown directly |
| Write | Page rises; scene blurs and stops completely | Page appears; scene is already static |
| Bloom reveal | Bud opens over ~1.5 s, once, the first time the garden is seen after a return | Open flower shown with "New" in its label |
| Press to Cabinet | Flower gathers, flattens and settles into the specimen; slips collect into clippings | Crossfade with the same silhouette and title |
| Prune | Tag or flower loosens and drifts out of frame | Removed with a short fade |

Motion communicates navigation, growth and arrival. It is never idle decoration that
competes with text. Ambient wind stays below the threshold where it draws the eye
away from writing, and it stops entirely while writing.

## Density

- At most about 24 interactive plants are rendered per bed. Older resting thoughts
  become background meadow density but stay reachable through the list and search.
- Only beds within the camera arc render. Off-arc assets load lazily.
- For 5, 25, 100 and 1,000 thoughts, the meadow stays legible because beds, not
  individual plants, carry the overview.

## Accessibility

- **Names.** Plants are buttons with names such as "Thought: ⟨title⟩, 4 entries, last
  written Sep 3, 1 tended note".
- **Keyboard.** ←/→ rotate, Tab moves through plants, Enter focuses or opens, and
  Escape steps back one level. Focus returns to the originating plant.
- **Contrast.** All text sits on opaque paper. Contrast is checked in light and dark.
- **Images.** Decorative imagery uses empty alternative text. Meaningful identity is
  also given in words.

## Assets

Assets are recorded in [assets/ASSET_MANIFEST.md](assets/ASSET_MANIFEST.md), and
generation prompts are in [assets/PROMPT_PACK.md](assets/PROMPT_PACK.md). Procedural
fallbacks keep the scene complete before photographic assets exist.
