import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getVerifiedAuthSubject, safeDashboardDestination } from "@/lib/auth-session";
import { readSupabasePublicConfig } from "@/lib/supabase/config";

import "./login.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Claim and save a private TrendsFast result.",
  robots: "noindex, nofollow, noarchive",
  referrer: "strict-origin",
};

const errorMessages: Record<string, string> = {
  verification_failed: "That sign-in link could not be verified. Start a fresh sign-in below.",
  project_already_owned:
    "This project already belongs to another account. Sign in with its original account or run a new scan.",
  claim_invalid:
    "That private claim has expired or was already used. Return to the result and try again.",
  claim_unavailable:
    "Your sign-in worked, but the project could not be claimed yet. Try again shortly.",
  request_rejected: "The sign-in request was rejected. Refresh this page and try again.",
  invalid_email: "Enter a valid e-mail address.",
  email_unavailable: "A magic link could not be sent right now. Try again shortly.",
  google_unavailable: "Google sign-in is unavailable right now. Try a magic link instead.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeDashboardDestination(typeof query.next === "string" ? query.next : undefined);
  const configured = Boolean(readSupabasePublicConfig());
  const subject = configured ? await getVerifiedAuthSubject().catch(() => null) : null;
  const error = typeof query.error === "string" ? errorMessages[query.error] : undefined;
  const sent = query.sent === "1";
  if (subject && !error) redirect("/auth/complete");

  return (
    <div className="login-shell">
      <section className="login-proof" aria-labelledby="login-heading">
        <p className="kicker">Save your private Next Move</p>
        <h1 id="login-heading">One result. Your project. No password.</h1>
        <p>
          Continue with Google or receive a one-time magic link. Authentication happens after the
          first useful result; nothing is published for you.
        </p>
        <ul>
          <li>Your claimed project stays private.</li>
          <li>Every recommendation keeps its original evidence and expiry.</li>
          <li>Your agent keys are project-scoped and shown only once.</li>
        </ul>
      </section>

      <section className="login-card" aria-label="Sign in to TrendsFast">
        <span className="login-index">AUTH / PKCE</span>
        <h2>Continue to your dashboard</h2>
        {error ? (
          <p className="login-notice login-error" role="alert">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p className="login-notice" role="status">
            Check your inbox. The magic link is single-use and expires on the Supabase Auth
            schedule. Open it in this browser so the sign-in remains bound to your request.
          </p>
        ) : null}
        {!configured ? (
          <p className="login-notice login-error" role="alert">
            Sign-in is not configured on this deployment yet. Your private scan remains available
            from its result link.
          </p>
        ) : null}

        {subject ? (
          <div className="login-authenticated-actions">
            <p>You are still signed in. The message above concerns only this project claim.</p>
            <Link className="login-email-button" href="/dashboard">
              Open your dashboard <span aria-hidden="true">→</span>
            </Link>
            <form action="/auth/logout" method="post">
              <button type="submit">Sign out and use another account</button>
            </form>
          </div>
        ) : (
          <>
            <form action="/auth/google" method="post">
              <input name="next" type="hidden" value={next} />
              <button className="login-google" type="submit" disabled={!configured}>
                <span aria-hidden="true">G</span> Continue with Google
              </button>
            </form>

            <div className="login-divider" aria-hidden="true">
              <span>or</span>
            </div>

            <form action="/auth/magic-link" method="post">
              <input name="next" type="hidden" value={next} />
              <label htmlFor="login-email">E-mail address</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                placeholder="you@company.com"
                required
                disabled={!configured}
              />
              <button className="login-email-button" type="submit" disabled={!configured}>
                E-mail me a magic link <span aria-hidden="true">→</span>
              </button>
            </form>
          </>
        )}
        <small>
          By continuing, you agree to the Terms and acknowledge the Privacy Policy. No password,
          team workspace, or publishing permission is created.
        </small>
      </section>
    </div>
  );
}
