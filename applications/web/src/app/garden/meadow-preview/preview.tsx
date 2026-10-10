"use client";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { GardenRing } from "../scene/garden-ring";
import { GardenScene } from "../scene/garden-scene";
import { syntheticGarden, syntheticTending } from "./fixtures";

const SCENES = {
  empty: { topics: 0, thoughts: 0, tending: null },
  "first-bed": { topics: 1, thoughts: 0, tending: null },
  five: { topics: 2, thoughts: 5, tending: null },
  "twenty-five": { topics: 4, thoughts: 25, tending: null },
  hundred: { topics: 6, thoughts: 100, tending: null },
  catalog: { topics: 3, thoughts: 18, tending: "catalog" },
  tended: { topics: 3, thoughts: 18, tending: "full" },
} as const;

type SceneName = keyof typeof SCENES;

export function MeadowPreview() {
  const params = useSearchParams();
  const name = (params.get("scene") ?? "twenty-five") as SceneName;
  const scene = SCENES[name] ?? SCENES["twenty-five"];
  const data = useMemo(
    () => syntheticGarden(scene.topics, scene.thoughts),
    [scene],
  );
  const tending = useMemo(
    () => (scene.tending ? syntheticTending(data, scene.tending) : undefined),
    [data, scene],
  );
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [focus, setFocus] = useState(params.get("focus") ?? "");
  const garden = data.gardens[0];
  const ring = Number(params.get("ring") ?? 0);
  const ringGardens = useMemo(
    () =>
      Array.from({ length: ring }, (_, i) => ({
        id: `ring-garden-${i}`,
        name: [
          "Work",
          "Home",
          "Reading",
          "The studio",
          "Health",
          "Letters",
          "Travel",
          "Learning",
          "Friends",
          "Money",
          "Craft",
          "Someday",
        ][i % 12],
        status: i === 5 ? "archived" : "active",
      })),
    [ring],
  );
  if (ring > 0)
    return (
      <main className="thinking-garden meadow-preview">
        <GardenRing
          gardens={ringGardens}
          currentId={ringGardens[0].id}
          onEnter={() => undefined}
          onClose={() => undefined}
          newGarden={
            <button className="secondary-button">＋ New garden</button>
          }
        />
      </main>
    );
  return (
    <main className="thinking-garden meadow-preview">
      <nav className="preview-scenes" aria-label="Preview scenes">
        {Object.keys(SCENES).map((s) => (
          <a
            key={s}
            href={`?scene=${s}`}
            aria-current={s === name ? "page" : undefined}
          >
            {s}
          </a>
        ))}
      </nav>
      <GardenScene
        garden={garden}
        plots={data.plots}
        seeds={data.seeds}
        entries={data.entries}
        tending={tending}
        topicId={topic}
        focusId={focus}
        onTopic={(id) => {
          setFocus("");
          setTopic(id);
        }}
        onFocus={setFocus}
        onOpenThought={() => undefined}
        onListView={() => undefined}
      />
    </main>
  );
}
