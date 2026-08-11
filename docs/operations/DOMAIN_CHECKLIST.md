# TrendsFast domain checklist

Target canonical origin: `https://trendsfast.com`.

Observed state on 2026-08-12: `trendsfast.com` returns `NXDOMAIN`, and no
TrendsFast Vercel project exists. Every item below remains unexecuted.

- [ ] `trendsfast.com` ownership is confirmed by the founder.
- [ ] A founder-owned Vercel `trendsfast` project is created, linked, and checked
      for duplicates.
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
- [ ] Redirect `www.trendsfast.com` to `https://trendsfast.com` with one permanent
      hop, preserving path and query.
- [ ] Set `APP_URL=https://trendsfast.com`; verify secure cookies, same-origin
      mutations, OAuth/Stripe return allowlists, canonical metadata, sitemap,
      robots, and webhook URL all use the canonical host.
- [ ] From an independent resolver/network, verify A/AAAA/CNAME, HTTP→HTTPS,
      `www`→apex, certificate SAN/expiry, HSTS, and no redirect loop.
- [ ] Run `CANONICAL_HOST=trendsfast.com DEPLOYMENT_URL=https://trendsfast.com pnpm verify:deployment`.

Record the actual Vercel-requested DNS values, registrar owner, applied time,
propagation observations, and final verification time in the release report.
