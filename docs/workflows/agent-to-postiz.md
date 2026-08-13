# Agent-to-Postiz handoff

TrendsFast does not connect to Postiz and stores no Postiz credential. This is a
human-approved HTTP workflow for an agent the founder controls:

```text
TrendsFast finds the opportunity
→ the founder's agent creates the asset
→ the founder approves it
→ the founder's agent may call Postiz
```

1. Request the current claimed-project Next Move with the founder's TrendsFast
   project key. Use a fresh idempotency key for a new scan and keep polling the
   returned status URL until it is ready.

   ```http
   POST /v1/projects/{project_id}/next-move HTTP/1.1
   Authorization: Bearer {trendsfast_project_key}
   Idempotency-Key: {one_uuid_for_this_attempt}
   Content-Type: application/json

   {"objective":"Find one timely founder-led post","generation_level":"draft"}
   ```

2. Validate `freshness.status == "CURRENT"`,
   `freshness.requires_new_scan == false`, and `auto_publish == false`. Open the
   evidence URLs and obtain founder approval. A `WAIT` or stale result stops the
   workflow.
3. Render the approved asset from `action_details`, `content_blueprint`, and—if
   present—`draft_content`. Never copy a REMIX source's protected expression.
4. Only after that approval, let the founder's agent call the Postiz endpoint
   configured in its own secret store. Do not place that endpoint, access token,
   workspace ID, or social-account credential in TrendsFast.

   ```http
   POST {founder_owned_postiz_create_endpoint} HTTP/1.1
   Authorization: Bearer {postiz_token_from_the_agent_secret_store}
   Content-Type: application/json

   {"content":"{approved_copy}","media":["{approved_asset_url}"],"publish":"manual_or_scheduled"}
   ```

The agent should persist the TrendsFast Next Move ID beside its own draft and
write the final `PUBLISHED`, `REPLIED`, `REMIXED`, or `SKIPPED` outcome back
through the authenticated TrendsFast dashboard. This document does not promise
compatibility with any particular Postiz API version; the founder-owned agent
must validate its current provider contract.
