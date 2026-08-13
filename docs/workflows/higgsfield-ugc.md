# Higgsfield UGC workflow

TrendsFast does not integrate with Higgsfield and stores no Higgsfield
credential. This optional handoff begins only after founder review of a current
`PUBLISH` or `REMIX` Next Move.

1. Load the result through the claimed-project API and verify its exact trend
   window has not expired.
2. Use `action_details`, the three differentiated hooks, tone, asset list,
   channel instructions, and production options to assemble a UGC brief. For a
   REMIX, preserve only the allowed pattern and enforce every `do_not_copy`
   instruction; source wording, identity, examples, and creative assets stay
   out.
3. Obtain explicit founder approval of the brief and any likeness, voice,
   product, or brand asset.
4. A founder-controlled agent may then call the Higgsfield endpoint configured
   in its own environment:

   ```http
   POST {founder_owned_higgsfield_generation_endpoint} HTTP/1.1
   Authorization: Bearer {higgsfield_token_from_the_agent_secret_store}
   Content-Type: application/json

   {"brief":"{approved_ugc_brief}","assets":["{approved_asset_url}"],"format":"{approved_format}"}
   ```

5. The founder reviews the output before any separate scheduling or publishing
   step and records the eventual outcome in TrendsFast.

The placeholder endpoint and payload deliberately avoid claiming a stable
vendor API. The founder-owned agent must validate Higgsfield's current contract,
rights, and consent controls; TrendsFast remains an intelligence and review
layer, not a generation or publishing credential store.
