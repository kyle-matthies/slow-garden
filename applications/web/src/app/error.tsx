"use client";

import type { ReactNode } from "react";
import { Sprout } from "./login/sprout";
import "./login/login.css";

export default function ErrorPage({
  reset,
  children,
}: {
  reset: () => void;
  /** A further way on, beside the retry (browser mode: back to the previous garden). */
  children?: ReactNode;
}) {
  return (
    <main className="calm-page">
      <div className="calm-centre" role="alert">
        <Sprout size={56} />
        <p className="panel-kicker">The garden paused safely</p>
        <h1>Nothing was silently lost.</h1>
        <p>Slow Garden could not complete that request. Try again when the connection is stable.</p>
        <button className="primary-button" type="button" onClick={reset}>Try again</button>
        {children}
      </div>
    </main>
  );
}
