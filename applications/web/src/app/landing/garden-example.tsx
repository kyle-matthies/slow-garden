"use client";

import { useState } from "react";

const examples = [
  {
    label: "A question",
    title: "What do I want from work?",
    first: { day: "Tuesday", text: "I keep saying I want a quieter job, then I volunteer for the loudest project." },
    second: { day: "Friday", text: "Best hour this week: the one where nobody needed me." },
    bloom: "Both lines reach for quiet. One of them also notices you choosing against it.",
  },
  {
    label: "A work idea",
    title: "A smaller first version",
    first: { day: "Monday", text: "What if we ran the workshop with one team before building the whole programme?" },
    second: { day: "Thursday", text: "The small session gave us a better question than the plan did." },
    bloom: "On Monday, small was a way to lower the risk. By Thursday, small was where the better question came from.",
  },
  {
    label: "A reading note",
    title: "Details worth keeping",
    first: { day: "Sunday", text: "The essay attends to ordinary things: a chipped bowl, a bus stop, light on a wall." },
    second: { day: "Wednesday", text: "Noticed the worn step outside the library and stopped to look." },
    bloom: "Wednesday’s worn step is the kind of ordinary detail you admired in Sunday’s essay.",
  },
];

function Sky({ time }: { time: "day" | "night" | "morning" }) {
  return (
    <svg className="method-sky" viewBox="0 0 320 72" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {time === "day" && (
        <>
          <circle className="sky-sun" cx="250" cy="26" r="11" />
          <g className="sky-rays">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <line key={a} x1="250" y1="8" x2="250" y2="3" transform={`rotate(${a} 250 26)`} />
            ))}
          </g>
          <path className="sky-hill" d="M0 72V58c50-14 96-12 150-2s118 10 170-6v22z" />
        </>
      )}
      {time === "night" && (
        <>
          <path className="sky-moon" d="M246 12a15 15 0 1 0 14 22 12 12 0 0 1-14-22z" />
          <g className="sky-stars">
            {[[38, 18, 1.4], [84, 40, 1], [126, 14, 1.2], [168, 34, 0.9], [204, 12, 1.1], [292, 44, 1.2], [60, 52, 0.8]].map(([x, y, r]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
            ))}
          </g>
          <path className="sky-hill" d="M0 72V60c50-12 96-14 150-4s118 12 170-4v20z" />
        </>
      )}
      {time === "morning" && (
        <>
          <path className="sky-dawn" d="M222 62a28 28 0 0 1 56 0z" />
          <g className="sky-rays">
            {[-60, -30, 0, 30, 60].map((a) => (
              <line key={a} x1="250" y1="26" x2="250" y2="19" transform={`rotate(${a} 250 62)`} />
            ))}
          </g>
          <path className="sky-hill" d="M0 72V62c50-10 96-14 150-6s118 10 170-2v18z" />
        </>
      )}
    </svg>
  );
}

/** The gold mark that signs everything the garden returns. */
function BloomMark() {
  return (
    <svg className="bloom-mark" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} cx="10" cy="4.6" rx="2.3" ry="4" transform={`rotate(${a} 10 10)`} />
      ))}
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

/**
 * Day, night, morning: the method on one made-up thought. A local
 * illustration only: no account, no saved notes, no AI request.
 */
export function GardenExample() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];

  return (
    <section className="method-sequence" aria-labelledby="example-heading">
      <div className="method-sequence-head">
        <p className="method-sequence-caption" id="example-heading">
          <span className="method-made-up">Made-up example</span> One thought, one night.
        </p>
        <fieldset className="landing-example-options">
          <legend className="sr-only">Choose an example thought</legend>
          {examples.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >{item.label}</button>
          ))}
        </fieldset>
      </div>

      <ol className="method-panels" aria-live="polite" aria-atomic="true">
        <li className="method-panel method-day">
          <Sky time="day" />
          <div className="method-panel-body">
            <p className="method-when">By day</p>
            <h2>You write. Nothing answers back.</h2>
            <div className="method-sheet">
              <h3>{example.title}</h3>
              <p className="method-entry"><span>{example.first.day}</span>{example.first.text}</p>
              <p className="method-entry"><span>{example.second.day}</span>{example.second.text}<i className="method-caret" aria-hidden="true" /></p>
            </div>
            <p className="method-aside">No chat, no autocomplete, no suggestions. The page stays as you left it.</p>
          </div>
        </li>

        <li className="method-panel method-night">
          <Sky time="night" />
          <div className="method-panel-body">
            <p className="method-when">Overnight</p>
            <h2>The garden is tended while you’re away.</h2>
            <div className="method-tending" aria-hidden="true">
              <span className="method-leaf" />
              <span className="method-thread"><i /><i /><i /></span>
              <span className="method-leaf" />
            </div>
            <p className="method-aside">An AI pass reads across the topics you allow. Your pages are not changed.</p>
          </div>
        </li>

        <li className="method-panel method-morning">
          <Sky time="morning" />
          <div className="method-panel-body">
            <p className="method-when">In the morning</p>
            <h2>You wake to a bloom.</h2>
            <article className="method-bloom" aria-label="Example bloom">
              <p className="method-bloom-kind"><BloomMark />Bloom · a connection <span>AI-derived</span></p>
              <p className="method-bloom-text">{example.bloom}</p>
              <p className="method-bloom-from">From your own words</p>
              <blockquote><span>{example.first.day}</span>“{example.first.text}”</blockquote>
              <blockquote><span>{example.second.day}</span>“{example.second.text}”</blockquote>
              <p className="method-bloom-actions" aria-hidden="true"><span>Keep</span><span>Correct</span><span>Prune</span></p>
            </article>
          </div>
        </li>
      </ol>
      <p className="landing-example-disclosure">
        The writing and the bloom above were written by hand for this page.
        Nothing here is saved or generated by AI.
      </p>
    </section>
  );
}
