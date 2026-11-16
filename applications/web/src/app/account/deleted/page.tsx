import type { Metadata } from "next";
import Link from "next/link";
import "./deleted.css";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

/** Shown once, after an account erased itself. Holds no account data. */
export default function AccountDeletedPage() {
  return (
    <main className="account-deleted">
      <h1>Your account is deleted.</h1>
      <p>
        Your gardens, every entry and saved version, and everything tending
        drew from them have been erased, along with your sign-in. This browser
        is signed out and its unsaved drafts are cleared.
      </p>
      <p>
        Copies inside our database provider’s routine backups are not
        reachable from the app and expire on the provider’s schedule.
      </p>
      <Link className="primary-button" href="/">
        Back to Slow Garden
      </Link>
    </main>
  );
}
