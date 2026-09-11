"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GardenData } from "@/lib/garden/types";
import {
  inviteReflection,
  readReturns,
  cancelReflection,
  respondToBloom,
} from "./actions";
import { locateRevisions } from "./returns-lookup";
import {
  ReturnCabinet,
  makeClippingResolver,
  parseEvidence,
  type BloomResponseKind,
  type CabinetBloom,
  type ResolvedClipping,
  type RevisionLocation,
} from "./returns-cabinet";
import { queueContinuation } from "@/lib/garden/continuation";
import { buildContinuation } from "./returns-continue";

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
    [located, setLocated] = useState<Record<string, RevisionLocation>>({}),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<string[]>([plotId]),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  const inviteId = useRef<string | null>(null);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const headingId = useId();
  const current = data.plots.find((p) => p.id === plotId);
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  const eligible = data.plots.filter(
    (p) =>
      p.ai_enabled &&
      !p.archived_at &&
      (p.id === plotId || (current?.cross_pollinate && p.cross_pollinate)),
  );
  const resolveClipping = useMemo(
    () => makeClippingResolver(data, located),
    [data, located],
  );
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  async function refresh() {
    setLoading(true);
    try {
      const next = await readReturns(data.gardenId);
      setReturns(next);
      const currentRevisions = new Set(data.entries.map((e) => e.revision_id));
      const missing = next.blooms
        .flatMap((b) => parseEvidence(b.evidence))
        .map((c) => c.revision_id)
        .filter((id) => !currentRevisions.has(id));
      if (missing.length) setLocated(await locateRevisions(missing));
    } catch {
      setMessage("Returns could not be loaded. Please retry.");
    } finally {
      setLoading(false);
    }
  }
  async function invite() {
    setPending(true);
    inviteId.current ??= crypto.randomUUID();
    try {
      const result = await inviteReflection(
        data.gardenId,
        selected,
        inviteId.current,
      );
      setMessage(
        result.ok
          ? "Invited. You can leave or keep writing. A return may take up to 24 hours."
          : result.message,
      );
      if (result.ok) {
        inviteId.current = null;
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
    response: BloomResponseKind,
    correction: string,
  ) {
    const result = await respondToBloom(
      crypto.randomUUID(),
      bloomId,
      response,
      correction,
    );
    if (!result.ok) throw new Error(result.message);
    await refresh();
  }
  async function cancel(passId: string) {
    const result = await cancelReflection(passId);
    setMessage(
      result.ok
        ? "Cancellation requested. Already-dispatched processing may take time to stop."
        : result.message,
    );
    await refresh();
  }
  function continueThought(bloom: CabinetBloom, clipping: ResolvedClipping) {
    if (!clipping.source.seed_id) return;
    let storage: Storage | null = null;
    try {
      storage = sessionStorage;
    } catch {
      storage = null;
    }
    const stored = queueContinuation(
      storage,
      data.tenantId,
      clipping.source.seed_id,
      buildContinuation(bloom, clipping),
    );
    setMessage(
      stored
        ? "A new entry is waiting with the clipping quoted. The rest is yours."
        : "This browser cannot hold a draft; copy the clipping by hand.",
    );
    if (!stored) return;
    onContinue(clipping.source.seed_id);
    requestAnimationFrame(() =>
      document.getElementById("writing-new")?.focus(),
    );
  }
  function close() {
    setOpen(false);
    requestAnimationFrame(() => openButton.current?.focus());
  }

  if (!open)
    return (
      <button
        ref={openButton}
        type="button"
        className="secondary-button"
        aria-expanded={false}
        onClick={() => {
          setOpen(true);
          refresh();
        }}
      >
        Open the Cabinet · AI returns
      </button>
    );
  return (
    <section className="return-cabinet" aria-labelledby={headingId}>
      <div className="cabinet-toolbar">
        <button type="button" className="plain-button" onClick={close}>
          Return to writing
        </button>
        <button
          type="button"
          className="plain-button"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "Checking…" : "Check for returns"}
        </button>
      </div>
      <ReturnCabinet
        headingId={headingId}
        headingRef={heading}
        passes={returns?.passes ?? []}
        blooms={returns?.blooms ?? []}
        responses={returns?.responses ?? []}
        resolveClipping={resolveClipping}
        onRespond={respond}
        onCancel={cancel}
        onContinue={continueThought}
        disabled={pending}
      >
        {data.aiAvailable &&
        current?.ai_enabled &&
        !current.archived_at &&
        garden?.status === "active" ? (
          <fieldset disabled={pending}>
            <legend>Invite a reflection on these topics</legend>
            {eligible.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) => {
                    inviteId.current = null;
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
            <p className="cabinet-note">
              Only these topics’ saved entries will be sent to the configured AI
              provider. No other garden participates.
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={pending || selected.length === 0}
              onClick={invite}
            >
              {pending ? "Inviting…" : "Invite a reflection"}
            </button>
          </fieldset>
        ) : (
          <p className="cabinet-note">
            {!data.aiAvailable
              ? "AI reflections are not available yet. Your permissions are saved. You can keep writing and review existing returns."
              : current?.archived_at || garden?.status === "archived"
                ? "Restore this garden and topic before requesting a reflection."
                : "AI permission is off for this topic. Enable Allow AI tending in Topic settings to request a reflection."}
          </p>
        )}
        <p role="status" aria-live="polite" className="cabinet-status">
          {message || (loading && !returns ? "Opening the Cabinet…" : "")}
        </p>
      </ReturnCabinet>
    </section>
  );
}
