"use client";
import { useState, useRef } from "react";
import type { GardenData } from "@/lib/garden/types";
import {
  inviteReflection,
  readReturns,
  cancelReflection,
  respondToBloom,
} from "./actions";
type Returns = Awaited<ReturnType<typeof readReturns>>;
export function GardenReturns({
  data,
  plotId,
  onContinue,
}: {
  data: GardenData;
  plotId: string;
  onContinue: (seedId: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [returns, setReturns] = useState<Returns | null>(null),
    [selected, setSelected] = useState<string[]>([plotId]),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const id = useRef<string | null>(null);
  const current = data.plots.find((p) => p.id === plotId);
  const eligible = data.plots.filter(
    (p) =>
      p.ai_enabled &&
      !p.archived_at &&
      (p.id === plotId || (current?.cross_pollinate && p.cross_pollinate)),
  );
  async function refresh() {
    try {
      setReturns(await readReturns(data.gardenId));
    } catch {
      setMessage("Returns could not be loaded. Please retry.");
    }
  }
  async function invite() {
    setPending(true);
    id.current ??= crypto.randomUUID();
    try {
      const result = await inviteReflection(
        data.gardenId,
        selected,
        id.current,
      );
      setMessage(
        result.ok
          ? "Invited. You can leave or keep writing. A return may take up to 24 hours."
          : result.message,
      );
      if (result.ok) {
        id.current = null;
        await refresh();
      }
    } catch {
      setMessage("Could not send. Please retry.");
    } finally {
      setPending(false);
    }
  }
  async function respond(
    bloomId: string,
    response: "keep" | "correct" | "prune",
  ) {
    const result = await respondToBloom(
      crypto.randomUUID(),
      bloomId,
      response,
      corrections[bloomId] ?? "",
    );
    setMessage(result.ok ? "Your response is saved." : result.message);
    if (result.ok) await refresh();
  }
  if (!open)
    return (
      <button
        className="secondary-button"
        onClick={() => {
          setOpen(true);
          refresh();
        }}
      >
        AI reflections
      </button>
    );
  return (
    <section className="return-cabinet" aria-label="AI reflections">
      <div className="action-row">
        <h2>AI reflections</h2>
        <button className="plain-button" onClick={() => setOpen(false)}>
          Close
        </button>
        <button className="plain-button" onClick={refresh}>
          Check for reflections
        </button>
      </div>
      <p>
        AI interpretations are separate from your writing. There may be nothing
        new to offer, and that is fine.
      </p>
      {data.aiAvailable &&
      current?.ai_enabled &&
      !current.archived_at &&
      data.gardens.find((g) => g.id === data.gardenId)?.status === "active" ? (
        <fieldset disabled={pending}>
          <legend>Invite a reflection on these topics</legend>
          {eligible.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => {
                  id.current = null;
                  setSelected(
                    e.target.checked
                      ? [...selected, p.id]
                      : selected.filter((x) => x !== p.id),
                  );
                }}
              />
              {p.name}
            </label>
          ))}
          <p>
            Only these topics’ saved entries will be sent to the configured AI
            provider. No other garden participates.
          </p>
          <button
            className="primary-button"
            disabled={pending || selected.length === 0}
            onClick={invite}
          >
            {pending ? "Inviting…" : "Invite a reflection"}
          </button>
        </fieldset>
      ) : (
        <p>
          {!data.aiAvailable
            ? "AI reflections are not available yet. Your permissions are saved. You can keep writing and review existing reflections."
            : current?.archived_at ||
                data.gardens.find((g) => g.id === data.gardenId)?.status ===
                  "archived"
              ? "Restore this garden and topic before requesting a reflection."
              : "AI permission is off for this topic. Enable Allow AI tending in Topic settings to request a reflection."}
        </p>
      )}
      <p role="status">{message}</p>
      {returns?.passes.map((pass) => (
        <article className="pass-return" key={pass.id}>
          <p className="panel-kicker">
            {pass.status} · {new Date(pass.created_at).toLocaleDateString()}
          </p>
          {["queued", "processing"].includes(pass.status) && (
            <button
              className="plain-button"
              onClick={async () => {
                const result = await cancelReflection(pass.id);
                setMessage(
                  result.ok
                    ? "Cancellation requested. Already-dispatched processing may take time to stop."
                    : result.message,
                );
                await refresh();
              }}
            >
              Cancel reflection
            </button>
          )}
          {pass.no_output_reason && <p>{pass.no_output_reason}</p>}
          {pass.status === "failed" && (
            <p>
              No reflection was published. Your writing is safe; you can invite
              a new pass.
            </p>
          )}
          {pass.status === "withdrawn" && (
            <p>
              This return was withdrawn after its topic permissions changed.
            </p>
          )}
          {returns.blooms
            .filter((b) => b.pass_id === pass.id)
            .map((b) => {
              const evidence = b.evidence as {
                revision_id: string;
                excerpt: string;
              }[];
              const stale = evidence.some(
                (e) =>
                  !data.entries.some(
                    (r) => r.revision_id === e.revision_id && !r.archived_at,
                  ),
              );
              const response = returns.responses.find(
                (r) => r.bloom_id === b.id,
              );
              return (
                <div className="bloom-review" key={b.id}>
                  <p className="panel-kicker">AI interpretation · {b.kind}</p>
                  {stale && (
                    <p>
                      Historical reflection: a source has changed or is no
                      longer active.
                    </p>
                  )}
                  <p className="entry-body">{b.interpretation}</p>
                  <details>
                    <summary>
                      Why this appeared · exact source clippings
                    </summary>
                    {evidence.map((e, i) => (
                      <blockquote key={i}>
                        <p className="entry-body">{e.excerpt}</p>
                        <small>Source revision {e.revision_id}</small>
                      </blockquote>
                    ))}
                  </details>
                  {response && (
                    <p>
                      Your response: {response.response}
                      {response.correction ? ` — ${response.correction}` : ""}
                    </p>
                  )}
                  <div className="action-row">
                    <button
                      className="plain-button"
                      onClick={() => respond(b.id, "keep")}
                    >
                      Keep
                    </button>
                    <button
                      className="plain-button"
                      onClick={() => respond(b.id, "prune")}
                    >
                      Prune
                    </button>
                    {data.entries.find(
                      (r) => r.revision_id === evidence[0]?.revision_id,
                    ) && (
                      <button
                        className="plain-button"
                        onClick={() =>
                          onContinue(
                            data.entries.find(
                              (r) => r.revision_id === evidence[0].revision_id,
                            )!.seed_id,
                          )
                        }
                      >
                        Continue this thought
                      </button>
                    )}
                  </div>
                  <details>
                    <summary>Correct this interpretation</summary>
                    <label>
                      Your correction
                      <textarea
                        maxLength={2000}
                        value={corrections[b.id] ?? ""}
                        onChange={(e) =>
                          setCorrections({
                            ...corrections,
                            [b.id]: e.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      className="secondary-button"
                      onClick={() => respond(b.id, "correct")}
                    >
                      Save correction
                    </button>
                  </details>
                </div>
              );
            })}
        </article>
      ))}
    </section>
  );
}
