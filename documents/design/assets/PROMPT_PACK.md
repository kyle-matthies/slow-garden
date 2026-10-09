# Garden asset prompt pack

Matched prompts for owner-run image generation. Generate each set in one session so
light, paper and colour stay consistent. Record every accepted output in
[ASSET_MANIFEST.md](ASSET_MANIFEST.md). Do not include people, text, logos or brand marks.

## Shared style line

> Soft natural daylight, gentle film grain, quiet botanical realism, restrained
> palette of field greens, pale sky cyan, warm ivory paper, no text, no people, no
> logos, high detail without hyper-saturation.

## Pressed specimens (one per species)

> A single pressed and dried **{species}** stem with its flower and two or three
> leaves, flattened on warm handmade cotton paper with a deckled edge, one strip of
> translucent washi tape across the stem, photographed straight down under soft
> diffuse light, subtle paper fibres, natural faded pigment, centred with generous
> margins, shallow realistic shadow. {shared style line}

Species: cosmos (white), corn poppy, cornflower, foxglove, yarrow, red clover,
dog rose, chamomile, lupine, meadow grass seed head.

Deliver at 2048 px tall; the pipeline produces the 320, 640 and 1280 px widths.

## Environment layers (per palette)

Palettes: dawn, morning, golden hour, dusk, night.

- **Far layer:** "Distant rolling hills and a soft treeline under a {palette} sky, atmospheric
  haze, very wide panoramic strip that tiles seamlessly left to right, nothing in
  the foreground." {shared style line}
- **Mid layer:** "A gently sloping wildflower meadow seen from knee height in {palette}
  light, sparse scattered wildflowers, soft depth of field, wide seamless panorama,
  transparent sky." {shared style line}
- **Near layer:** "Close foreground grass blades and a few seed heads at the bottom edge,
  soft-focus, {palette} backlight, transparent above, seamless horizontal tile."
  {shared style line}

Deliver at 5120 × 1440 for desktop. The pipeline crops and resizes to 2560 and 1290 px.

## Paper and fixings

- "Warm ivory handmade cotton paper texture, subtle fibres, tileable, flat even light."
- "A single strip of translucent cream washi tape, slightly creased, isolated on
  transparent background."
- "A small brushed-steel paperclip, top-down, isolated on transparent background."
