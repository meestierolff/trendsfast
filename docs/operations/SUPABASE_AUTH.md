# Supabase Auth launch setup

Status: Google PKCE, browser-bound e-mail magic-link, claim consumption, member
authorization, dashboard, and owner key-management application paths are
implemented and tested locally. Supabase provider, redirect, custom-SMTP, and
preview journey acceptance remain unverified.

TrendsFast uses Supabase Auth for identity only. Browser clients never query the application
schema. The server verifies the signed Auth identity, then every project read or mutation applies a
relational membership predicate through the application repository.

Launch methods are intentionally limited to:

- Continue with Google
- e-mail magic link

There are no passwords, teams, invitations, passkeys, MFA screens, or direct Supabase table calls
in this release.

## Application variables

Set both publishable values on the public web deployment:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

These values are safe to expose to the browser. They do not replace the server-side database role
URLs and do not grant `anon` or `authenticated` access to TrendsFast business tables.
The public web deployment also needs the private `MEMBER_DATABASE_URL` for the dedicated
`trendsfast_member_runtime` login. Never prefix that value with `NEXT_PUBLIC_`, and never reuse the
anonymous public-data-plane URL for claim or dashboard repositories.

## URL configuration

Configure the canonical production Site URL and add exact preview/development callback origins to
the Supabase redirect allow list. Production uses:

```text
https://trendsfast.com/auth/callback**
https://trendsfast.com/auth/confirm**
```

The path-scoped suffix is required because the current Supabase client appends its reserved
`sb_flow_id` correlation query parameter. Keep the host and callback path exact; do not add a host
or site-wide production wildcard. Preview callback hosts must likewise be explicit and temporary.
The application accepts only fixed dashboard destinations after authentication, so an attacker
cannot turn `next` into an open redirect. Supabase also requires every `redirectTo` destination to
match its configured allow list. See the official [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).

## Google

1. Create a Google Web OAuth client and configure the minimum `openid`, e-mail, and profile scopes.
2. Add the application origin under Authorized JavaScript origins.
3. Add the Supabase project callback URL shown on the Supabase Google provider screen under Google
   Authorized redirect URIs. Google returns to Supabase first; Supabase then returns the PKCE code
   to `/auth/callback`.
4. Store the Google client ID and client secret in the Supabase Auth provider configuration. They
   are not application/Vercel variables.
5. Add the path-scoped `https://trendsfast.com/auth/callback**` entry to the Supabase Auth redirect
   allow list.
6. Verify the consent-screen brand before the founder cohort where possible.

The callback strictly validates the returned `sb_flow_id`, calls
`exchangeCodeForSession(code, { flowId })`, and stores the resulting session in cookies,
following the official [Google PKCE callback flow](https://supabase.com/docs/guides/auth/social-login/auth-google).
No Google access or refresh token is retained because TrendsFast does not call Google APIs on the
user's behalf.

## Magic-link e-mail

Configure custom production SMTP before enabling e-mail sign-in. Supabase's development mail
service is not a launch sender. Configure sender identity, SPF, DKIM, DMARC, delivery monitoring,
and a support-visible bounce path; see [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Use this PKCE-compatible Magic Link template:

```html
<h2>Sign in to TrendsFast</h2>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Open TrendsFast</a></p>
```

`/auth/confirm` accepts only `type=email`, then calls `verifyOtp({ token_hash, type: "email" })`.
The token hash never enters analytics. This is the official server-side template pattern from
[Supabase passwordless e-mail guidance](https://supabase.com/docs/guides/auth/auth-email-passwordless).
Using `RedirectTo` is intentional: the application supplies the exact allow-listed
`/auth/confirm?next=…` URL, so production and an explicitly configured preview return to the
deployment and fixed dashboard destination that initiated sign-in. The template uses `&` because
this route always supplies that bounded `next` query. Keep every permitted origin in Supabase's
redirect allow list.

The token-hash link is also bound to the browser that requested it. Before sending, TrendsFast
generates a separate 32-byte flow secret in a short-lived, `HttpOnly`, `Secure`, `SameSite=Lax`
cookie scoped to `/auth/confirm`. Only its SHA-256 correlation value is included in `RedirectTo`
and therefore in the e-mail link. The callback requires the exact cookie/hash pair and the
Supabase `sb_flow_id` before it calls `verifyOtp`, then clears the flow cookie on the first callback
attempt. A forwarded attacker link opened in another browser therefore cannot authenticate an
attacker account and consume that browser's pending project claim.

## Cookie-based PKCE session

The web application uses `@supabase/supabase-js` and `@supabase/ssr`, with one browser client and a
new server client per request. The Next.js Proxy refreshes session cookies by calling
`auth.getClaims()`. Server authorization never trusts `getSession()` by itself. Protected pages
verify JWT claims; callback profile synchronization additionally calls `getUser()` and requires the
returned user ID to match the verified JWT subject. This follows the current
[Supabase SSR package guidance](https://supabase.com/docs/guides/auth/choosing-a-server-package)
and [Next.js client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
Every client enables the installed Supabase client's bounded PKCE flow-ID correlation so starting
Google and magic-link flows, or using multiple tabs, cannot exchange a callback code with a
different flow's verifier.

## Private result claim

The claim boundary is separate from OAuth:

1. The private result sends its delivery capability in a same-origin, byte-bounded POST body to
   `/api/project-claims`.
2. The server resolves the exact ready, founder-reviewed delivery and generates 32 random bytes.
3. Only `sha256:<hex>` is stored. The raw claim is written to `tf_project_claim` with `HttpOnly`,
   `SameSite=Lax`, `Path=/`, `Secure` in production, and a maximum fifteen-minute lifetime bounded
   by the delivery expiry.
4. OAuth state contains only Supabase PKCE state. It never contains the private delivery token,
   project claim, e-mail, or a project identifier.
5. After Google code exchange or magic-link verification, the server consumes the claim in one
   database transaction and clears the cookie.
6. The first account becomes `OWNER`. The same owner receives `ALREADY_OWNER`. A different owner
   receives `OWNERSHIP_CONFLICT`; the claim is still consumed so it cannot be replayed.
7. Expired, invalidated, malformed, and already-consumed claims fail closed.

The durable claim consumption row is the audit record. It contains the hash and verified
application user reference, never the raw claim or delivery token.

The claim cookie is intentionally browser-bound. A founder using an e-mail magic link should open
it in the browser that initiated the claim; transferring the claim through an e-mail URL would put
private capability material into e-mail and is deliberately unsupported.

## Member route matrix

| Route                 | Access                   | Purpose                                                                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `/login`              | Public, no-store         | Google and e-mail magic-link entry after the first result                                                               |
| `/auth/callback`      | Supabase PKCE callback   | Exchanges a Google authorization code, verifies identity, consumes a pending claim                                      |
| `/auth/confirm`       | Supabase e-mail callback | Verifies `token_hash` with `type=email`, then consumes a pending claim                                                  |
| `/dashboard`          | Verified member          | Selects the first owned project or shows the first-scan empty state                                                     |
| `/dashboard/today`    | Verified owner           | Current action-specific move, evidence, expiry, outcome, copy, and refresh controls                                     |
| `/dashboard/projects` | Verified owner           | Compact URL, inferred-context, assumption, voice, and capability confirmation; observed facts remain read-only evidence |
| `/dashboard/history`  | Verified owner           | Earlier moves with validity, freshness, outcomes, and feedback                                                          |
| `/dashboard/agents`   | Verified entitled owner  | Project-key issue, one-time secret display, revoke/reissue, examples, scopes, and last use                              |
| `/dashboard/billing`  | Verified member          | Existing Stripe-hosted billing and portal boundaries without blocking the free scan                                     |

Changing a project URL collision-checks the normalized URL, invalidates the former current context,
and marks dependent moves stale. A fresh entitled refresh must re-observe and re-infer the new site.
The dashboard refresh route uses the managed provider-effect gate and server-resolved per-scan cost
reservation; the external `/v1` rollout flag and browser-supplied cost values cannot control it.

Project API keys are named and scoped per project. The server derives rate and provider-cost caps
from deployment policy, returns a raw secret once, and persists only its slow hash and visible
prefix. Reissue atomically marks the old key revoked in the UI and database. Multiple keys share
one project's entitlement and usage allowance rather than multiplying it.

## Application authorization and ACL proof

`auth.users.id` is mirrored into `user_profiles.auth_user_id`; the migration never changes
`auth.users`. `project_memberships` is the source of project ownership. `project_claims` is the
single-use bridge from an anonymous private result to that ownership.

The hosted ACL check must prove:

- `PUBLIC`, `anon`, and `authenticated` have zero privileges on the three application-auth tables
  and all business tables;
- the public data-plane role has no application-auth-table privileges, while the dedicated member
  server role has only the exact membership, claim, dashboard, and key-management DML it needs;
- dashboard repository queries contain the verified Auth subject and membership predicate;
- API-key creation, reissue, and revocation verify the key's project inside the same server-side
  authorization boundary;
- the raw API key is returned once and never persisted.

## Preview acceptance

Do not mark Supabase Auth complete until the exact preview deployment passes:

1. unauthenticated `/dashboard` redirects to `/login`;
2. Google returns through `/auth/callback` and refresh survives a second request;
3. the custom-SMTP magic link returns through `/auth/confirm` in the initiating browser, while the
   same forwarded link is rejected in a browser without its flow cookie;
4. claim cookie attributes are correct and no private token appears in URL, logs, analytics, e-mail,
   or `Referer`;
5. first claim succeeds; replay and expired claim fail; a second account gets a conflict;
6. a logged-in account without a claim sees “Run your first scan”;
7. project A cannot read or mutate project B;
8. local sign-out removes the session and protected routes redirect again.
