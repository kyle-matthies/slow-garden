# Botanical scrapbook — future visual phase

Status: Direction accepted for future design exploration; implementation deferred.
Owner feedback: 2026-09-09. Functional navigation and writing clarity ship first.

## Intended experience

The app is a personal scrapbook documenting a garden that we imagine exists outside.
Thought pages collect notes and botanical clippings over time. Aim for authentic,
high-fidelity materials: photographed or convincingly realistic pressed flowers,
clipped stems and leaves, small pieces of tape, field-note labels, warm paper,
subtle paper edges and shadows. Depth comes from layered physical materials, not
from a navigable 3D world. Avoid flat cartoon flowers and decorative repetition.

A thought is a page-like evolving thread; entries are its dated notes. Floral
identity should remain recognizable when moving between an overview and that page.
Do not encode mood, confidence, importance, completion, or engagement in flowers.
User writing and AI reflections must remain visibly separate.

## Existing references and continuity

Review [Meadow and Cabinet](MEADOW_AND_CABINET.md),
[visual directions](VISUAL_DIRECTIONS_BRIEF.md), their
[evaluation](VISUAL_DIRECTIONS_EVALUATION.md), and the existing
[Cabinet reference](references/mobile-cabinet.png) before designing new treatments.
The owner's recollection of taped flower clippings is a direction, not proof that
one specific existing mockup is the exact reference. Preserve prior decisions as
history; the scrapbook direction updates the future web aesthetic without claiming
the original Meadow concept has already been rebuilt.

## Work packages and acceptance gates

1. Inventory the existing assets, identify the closest clipping reference, and
   prepare two scrapbook treatments for an overview and a thought with dated entries.
   Obtain owner selection before production styling or an asset replacement campaign.
2. Establish a licensed botanical asset library with provenance, usage rights,
   transparent cutouts, mobile sizes, and stable object-to-specimen assignments.
   Test recognition across overview, thought, and reflection views. Collisions must
   not make different thoughts look like copies of each other.
3. Define paper, tape, shadows, typography, responsive spacing, selected states, and
   loading/error/empty/archive treatments. Decoration must never obscure writing,
   timestamps, navigation, focus indicators, source attribution, or controls.
4. Validate at phone and desktop sizes, with keyboard navigation, screen readers,
   200% zoom, reduced motion, and contrast checks. Decorative specimens have empty
   alternative text; any meaningful identity is also expressed in readable text.
5. Compare page weight and rendering performance against the functional release.
   Use responsive compressed assets and lazy loading for offscreen specimens. Approve
   only if the writing interface remains responsive on a representative mobile device.

## Explicitly deferred

Photographic asset generation/purchase, full visual redesign, spatial garden
navigation, motion, branching diagrams, and a new flower growth grammar. This phase
must not add chat, live critique, automatic rearrangement, or AI activation.
