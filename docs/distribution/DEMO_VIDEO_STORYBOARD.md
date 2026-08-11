# TrendsFast demo video storyboard

Status: recording plan only. No public demo video is claimed or configured.

## Goal

Show an unknown technical founder the complete URL-to-Next-Move loop in 60–75
seconds: submit a public product URL, see bounded research progress, inspect one
founder-reviewed decision and its evidence, and understand how an HTTP-capable
agent consumes the same result.

The video must use the real TrendsFast interface. Do not use generated product
screens, composited provider responses, fake customers, invented metrics, or an
unreviewed result.

## Recording gate

Before recording a scene as live, record all of the following in the release
report:

- deployed URL and immutable release SHA;
- production source read-back records for every source visible in the scene;
- a consented dogfood subject and reviewed result, with private tokens removed;
- successful external smoke, mobile, accessibility, and evidence-link checks;
- confirmation that the result contains no private product data or secret.

Until that gate passes, record only fixture mode and keep the persistent label
`Product demo using example data` visible. Fixture footage must never use the
words “live result,” “connected source,” or “customer result.”

## Shot list

| Time   | Picture                                                                                  | Voiceover / on-screen message                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0–05s  | Landing hero. Cursor rests beside the URL field; no click animation yet.                 | “Researching every network is slow. TrendsFast turns one product URL into one evidence-backed Next Move.”       |
| 05–13s | Paste an approved public URL and submit once.                                            | “No signup or card before value. The request is private by default and bounded by a hard research-cost limit.”  |
| 13–21s | Persisted status screen. Show source states and founder-review state; no fake progress.  | “It shows which evidence sources ran, which were limited, and when founder review is still required.”           |
| 21–36s | Reveal the shared dark Next Move card: action, channel, topic, angle, format, hook, CTA. | “The product object is a decision—not a feed: what to say, where, in which format, why now, and for how long.”  |
| 36–47s | Open one original evidence receipt in a new tab, then return to the result.              | “Every supporting claim binds to stored source receipts. The model cannot invent a URL or swap the evidence.”   |
| 47–55s | Switch the example explorer to `WAIT`; show its explanation and limitations.             | “And when the evidence is weak, recent but not trending, or too dependent, the trustworthy answer is WAIT.”     |
| 55–65s | `/agents` API example: create, poll, structured result.                                  | “Approved agents use the same project-scoped REST contract. Native connectors are coming soon; HTTP works now.” |
| 65–75s | Return to the hero and focus the URL field.                                              | “Drop your product URL. I’ll run one free founder-reviewed trend and distribution scan.”                        |

If no consented live result exists, use the example explorer for the entire
decision/evidence segment and omit provider network inspectors. Do not splice a
fixture result into a production source panel.

## Capture specification

- Record desktop at 1440×900 and a separate 390×844 mobile proof; export at
  1080p or higher with readable text.
- Use reduced-motion defaults for legibility unless the motion sequence has
  already passed accessibility review.
- Keep browser zoom at 100%, hide bookmarks/extensions, and show the canonical
  HTTPS origin for any deployed scene.
- Make cuts only between durable product states. Do not accelerate a scan in a
  way that suggests a fake percentage or guaranteed completion time.
- Blur or crop capability tokens, API keys, founder session details, email
  addresses, provider request IDs, and non-public project identifiers.
- Do not show Stripe test data as an active paid plan.

## Captions and transcript

Publish WebVTT captions and a plain-text transcript beside the video. Captions
must include spoken limitations such as “example data,” “founder-reviewed,” and
“native connectors are coming soon”; do not leave truth qualifiers only in
visual text.

The configured player is allowed only when both
`NEXT_PUBLIC_DEMO_VIDEO_URL` and `NEXT_PUBLIC_DEMO_CAPTIONS_URL` point to the
approved assets. If either is absent or invalid, the application must keep the
interactive example explorer instead of rendering an empty player.

## Final review

- [ ] Every visible source label matches the dated public-source projection.
- [ ] Example footage is visibly and audibly labeled.
- [ ] Evidence links resolve and belong to the shown result.
- [ ] No auto-publishing, native connector, customer, outcome, or availability
      claim exceeds implemented and deployed truth.
- [ ] Captions, transcript, keyboard controls, contrast, and reduced-motion
      behavior pass review.
- [ ] The final CTA points to a verified deployed scan flow, not a placeholder.
- [ ] Founder approves the exact cut before publication.
