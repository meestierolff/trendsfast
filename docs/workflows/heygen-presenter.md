# HeyGen presenter workflow

TrendsFast does not call HeyGen or store a HeyGen key. It may recommend a
founder-on-camera, AI-avatar, or screen-recording production option when that
capability is saved for the project.

1. Request a `draft` Next Move through the claimed-project API.
2. Continue only for a current `PUBLISH` or `REMIX` result whose
   `action_details.production_options` and asset requirements support a
   presenter-led video. `REPLY` and `WAIT` never enter this workflow.
3. The founder reviews the evidence, premise, hooks, tone, non-copying guidance,
   and draft. Their own agent turns the approved material into a bounded video
   brief; factual claims must remain traceable to the supplied evidence.
4. After explicit approval, the founder-owned agent may submit that brief to its
   currently supported HeyGen video endpoint using a credential held outside
   TrendsFast:

   ```http
   POST {founder_owned_heygen_video_endpoint} HTTP/1.1
   Authorization: Bearer {heygen_token_from_the_agent_secret_store}
   Content-Type: application/json

   {"script":"{approved_script}","presenter":"{founder_approved_presenter}","aspect_ratio":"{approved_ratio}"}
   ```

5. Review the generated video before download, scheduling, or publishing. The
   asset is never posted automatically and should not imply that a breakout
   label is a performance promise.

No avatar ID, voice ID, consent artifact, generated asset, or vendor credential
is persisted by TrendsFast in this release. The agent must verify HeyGen's
current API and consent requirements at execution time.
