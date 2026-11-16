"use client";

import { useId } from "react";
import type { Entry } from "@/lib/garden/types";
import type { OnboardingBed } from "@/lib/garden/onboarding-draft";
import { ThoughtPlant } from "@/app/garden/scene/thought-plant";
import { SEED_PACKS, bedKeyFor, type SeedPack } from "./seed-pack-data";
import "./seed-pack.css";

/**
 * A packet shows the plant in flower, the way a real seed packet does. The
 * drawing is the same generated plant used for thoughts, given enough made-up
 * dated pages to be in bloom. Decorative only.
 */
const packetEntries = new Map<string, Entry[]>(
  SEED_PACKS.map((pack) => [
    pack.plant,
    Array.from({ length: 9 }, (_, i) => {
      const at = `2026-03-${String(i * 3 + 1).padStart(2, "0")}T09:00:00.000Z`;
      return {
        entry_id: `${pack.plant}-${i}`, revision_id: `${pack.plant}-${i}`, seed_id: pack.plant,
        body: "", revision_number: 2, created_at: at, revised_at: at, archived_at: null,
      };
    }),
  ]),
);

function Packet({ pack, open, kept, disabled, controls, onToggle }: {
  pack: SeedPack;
  open: boolean;
  kept: number;
  disabled: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="seed-packet"
      data-tone={pack.tone}
      data-open={open || undefined}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="seed-packet-flap" aria-hidden="true" />
      <span className="seed-packet-art">
        <ThoughtPlant seedId={pack.plant} entries={packetEntries.get(pack.plant)!} className="seed-packet-plant" />
      </span>
      <span className="seed-packet-label">
        <span className="seed-packet-name">{pack.name}</span>
        <span className="seed-packet-note">{pack.note}</span>
        <span className="seed-packet-count">
          {open ? `Opened · ${kept} of ${pack.topics.length} kept` : `${pack.topics.length} topics`}
        </span>
      </span>
    </button>
  );
}

export function SeedPackShelf({ packs, beds, writeIn, disabled, pageLocked, onTogglePack, onToggleBed, onStart }: {
  packs: readonly string[];
  beds: readonly OnboardingBed[];
  /** Key of the bed whose question heads the page, if any. */
  writeIn: string;
  disabled: boolean;
  /** The first thought is already saved, so its place can no longer change. */
  pageLocked: boolean;
  onTogglePack: (pack: SeedPack) => void;
  onToggleBed: (key: string) => void;
  onStart: (key: string, question: string) => void;
}) {
  const id = useId();
  const kept = beds.filter((b) => b.on).length;
  return (
    <section className="seed-packs" aria-labelledby={`${id}-title`}>
      <header className="seed-packs-head">
        <p className="panel-kicker">Or start from a seed pack</p>
        <h2 id={`${id}-title`} tabIndex={-1}>Seed packs</h2>
        <p>
          A few topics to begin with, each with one question. Open any that
          fit, keep what you like. None of it is required.
        </p>
      </header>

      <div className="seed-shelf">
        {SEED_PACKS.map((pack) => {
          const open = packs.includes(pack.id);
          const mine = pack.topics.map((topic, index) => ({
            topic,
            bed: beds.find((b) => b.key === bedKeyFor(pack.id, index)),
          }));
          const saved = mine.some(({ bed }) => bed?.id);
          return (
            <div className="seed-shelf-item" key={pack.id} data-open={open || undefined}>
              <Packet
                pack={pack}
                open={open}
                kept={mine.filter(({ bed }) => bed?.on).length}
                disabled={disabled || saved}
                controls={`${id}-${pack.id}`}
                onToggle={() => onTogglePack(pack)}
              />
              {open && (
                <div className="seed-beds" id={`${id}-${pack.id}`} role="group" aria-label={`Topics in ${pack.name}`}>
                  <p className="seed-beds-title">
                    <span>{pack.name}</span> becomes these topics
                  </p>
                  <ul>
                    {mine.map(({ topic, bed }) => {
                      if (!bed) return null;
                      const here = writeIn === bed.key;
                      return (
                        <li key={bed.key} className="seed-bed" data-on={bed.on || undefined} data-here={here || undefined}>
                          <label className="seed-bed-keep">
                            <input
                              type="checkbox"
                              checked={bed.on}
                              disabled={disabled || !!bed.id}
                              onChange={() => onToggleBed(bed.key)}
                            />
                            <span className="seed-bed-name">{topic.name}</span>
                            {bed.id && <span className="seed-bed-saved">saved</span>}
                          </label>
                          <button
                            type="button"
                            className="seed-bed-question"
                            aria-pressed={here}
                            disabled={disabled || pageLocked || !bed.on}
                            onClick={() => onStart(bed.key, topic.question)}
                          >
                            <span className="seed-bed-question-text">{topic.question}</span>
                            <span className="seed-bed-question-cue">{here ? "On your page" : "Start here"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="seed-packs-tally" role="status">
        {kept === 0
          ? "No pack opened. A blank page is a fine way to begin."
          : `${kept} ${kept === 1 ? "topic" : "topics"} will be planted when you save.`}
      </p>
    </section>
  );
}
