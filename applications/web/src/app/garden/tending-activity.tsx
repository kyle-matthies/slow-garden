import type { TendingHistory, TendingPassStatus } from "@/lib/garden/tending-history";
import type { Tending } from "@/lib/garden/scene/tending";
import { EntryTime } from "./entry-time";

const labels: Record<TendingPassStatus, string> = {
  queued: "Waiting to process", processing: "Processing", complete: "Completed",
  failed: "Did not complete", cancelled: "Cancelled", withdrawn: "Withdrawn after a source or permission change",
};

export function TendingActivity({ history, tending }: { history?: TendingHistory; tending?: Tending }) {
  const marks = tending?.marks.filter((mark) => mark.response !== "prune").length ?? 0;
  const blooms = tending?.blooms.filter((bloom) => bloom.response !== "prune").length ?? 0;
  return (
    <section className="tending-activity" aria-label="Tending activity">
      <h3>Tending activity in this garden</h3>
      <p>A saved preference allows tending. A completed pass shows that processing actually happened. A manual pass does not confirm an overnight schedule.</p>
      {!history?.available ? (
        <p role="status">Tending history is temporarily unavailable. Your writing is still here.</p>
      ) : history.passes.length === 0 ? (
        <p>No tending passes have been recorded for this garden yet.</p>
      ) : (
        <ol>
          {history.passes.map((pass) => (
            <li key={pass.id}>
              <strong>{labels[pass.status]}</strong>{" · "}
              <EntryTime value={pass.finishedAt ?? pass.createdAt} />
            </li>
          ))}
        </ol>
      )}
      {!!tending && (
        <p>{marks} catalogue {marks === 1 ? "mark" : "marks"} and {blooms} {blooms === 1 ? "reflection" : "reflections"} available in this garden. Catalogue marks appear with their thoughts; reflections appear in the Cabinet. A completed pass can return no new reflection.</p>
      )}
    </section>
  );
}
