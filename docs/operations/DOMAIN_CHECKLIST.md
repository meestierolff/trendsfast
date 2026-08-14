# TrendsFast domain checklist

Target canonical origin: `https://trendsfast.com`.

Current pre-deploy state on 2026-08-13: founder ownership of registered
`trendsfast.com` at Spaceship and Vercel public project
`prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC` are recorded. No domain association, exact
Vercel DNS assignment, public-resolution read-back, or TLS proof exists. Every
DNS item below remains unexecuted. Do not associate a custom domain until the
exact Hobby release passes its immutable and stable generated-origin smokes.

- [ ] `trendsfast.com` ownership is confirmed by the founder.
- [x] One founder-owned Vercel `trendsfast` project is created, linked, and
      checked for duplicates.
- [ ] Add both hosts:

  ```bash
  vercel domains add trendsfast.com trendsfast
  vercel domains add www.trendsfast.com trendsfast
  ```

- [ ] Inspect `vercel domains inspect trendsfast.com` and
      `vercel domains inspect www.trendsfast.com`.
- [ ] Copy the exact A/AAAA/CNAME/TXT records Vercel reports to the registrar.
      Do not substitute generic records or claim DNS completion before public
      resolution verifies them.
- [ ] Wait for both Vercel verification and publicly trusted TLS.
- [x] Keep the tracked Next.js redirect in `apps/web/next.config.ts`: its exact
      `www.trendsfast.com` host condition returns a permanent `308` directly to
      `https://trendsfast.com/:path*`. The shared path wildcard and destination
      without a replacement query preserve the original path and query. The
      exact host condition excludes generated public aliases and the ops host.
- [ ] After both custom domains resolve with trusted TLS, verify the configured
      redirect takes exactly one hop and preserves representative paths and
      queries.
- [ ] Set the local inventory marker to
      `SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-off`; do not edit the
      derived `APP_URL`, `PUBLIC_APP_URL`, or `PUBLIC_SCANS_ENABLED` values
      independently. Run `pnpm env:prepare-hobby` and verify it sets public
      `APP_URL`/`PUBLIC_APP_URL` and ops `PUBLIC_APP_URL` to
      `https://trendsfast.com`, keeps the generated ops `APP_URL` unchanged,
      and keeps scans off.
- [ ] Rerun both strict check/apply environment imports, founder-deploy both
      accepted surfaces, smoke the new immutable public deployment, make that
      exact deployment Current, repeat its stable-origin smoke, and repeat the
      application-authenticated ops acceptance. Never attach a custom domain
      to the ops project; its Production alias remains application-gated rather
      than protected by Standard Vercel Authentication on Hobby.
- [ ] Verify secure cookies, same-origin mutations, OAuth/Stripe return
      allowlists, canonical metadata, sitemap, robots, and webhook URL all use
      the canonical host.
- [ ] Verify the dedicated Turnstile widget accepts `trendsfast.com` and
      `www.trendsfast.com` in addition to `trendsfast.vercel.app`, with exact
      action `public_scan` and no wrong-host acceptance.
- [ ] From an independent resolver/network, verify A/AAAA/CNAME, HTTP→HTTPS,
      `www`→apex, certificate SAN/expiry, HSTS, and no redirect loop.
- [ ] Run `CANONICAL_HOST=trendsfast.com DEPLOYMENT_URL=https://trendsfast.com pnpm verify:deployment`.

After Halio and ShipToUsers dogfood and the complete Turnstile matrix pass, set
`SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-on` and repeat the same
prepare/import/deploy/immutable-smoke/Current/stable-smoke sequence. Never
enable the derived scan flag by itself.

First write the exact founder-approved results for the tested immutable
deployment to ignored mode-`0600`
`.var/private/hobby-scan-enablement.json` as specified in the Hobby launch
runbook. The strict public import rejects scans-on without this evidence or if
its accepted SHA, deployment provenance, site-key hash, host/action matrix, or
dogfood results drift.

Record the actual Vercel-requested DNS values, registrar owner, applied time,
propagation observations, and final verification time in the release report.
