import { Sprout } from "./login/sprout";
import "./login/login.css";

export default function Loading() {
  return (
    <main className="calm-page">
      <div className="calm-centre" role="status" aria-live="polite">
        <Sprout size={56} growing />
        <p className="panel-kicker">Returning to the garden</p>
        <h1>Gathering what you left here…</h1>
      </div>
    </main>
  );
}
