# Incident response plan

## Before launch

Privately record a primary founder incident lead, security contact, privacy/legal
contact, infrastructure owners, provider contacts, and a backup decision maker.
Enable MFA, provider billing alerts, database backups, log access controls, and
an out-of-band communication channel. Conduct one tabletop covering malicious
URL fetching plus provider-key exposure.

## Lifecycle

1. **Declare:** create a private incident ID, UTC start time, severity, reporter,
   and decision owner.
2. **Contain:** disable the narrow input/provider/checkout/share path; protect
   evidence and logs.
3. **Assess:** identify data, tenants, provider spend, evidence, regions, and
   time window affected. State unknowns explicitly.
4. **Eradicate:** rotate credentials, patch the boundary, invalidate unsafe
   artifacts, and add a failing-then-passing regression.
5. **Recover:** deploy through normal review, verify from an independent path,
   restore status gradually, and monitor.
6. **Notify:** founder/legal owner determines user, provider, insurer, regulator,
   and public notices and deadlines. Do not speculate.
7. **Learn:** publish an appropriately redacted postmortem with owners and dates.

## Evidence handling

Collect only what is needed. Restrict access, hash/export immutable logs where
available, record chain of custody for serious events, and never paste secrets
or customer payloads into tickets/chat. Use stable IDs and redacted excerpts.

## Communication template

```text
Incident ID / severity:
Confirmed start/detection times (UTC):
Current user impact:
Systems/data/providers affected:
Containment completed:
What remains unknown:
Next update time:
Incident lead / legal reviewer:
```

Public statements must distinguish confirmed facts from investigation and never
claim “no data affected” without evidence.
