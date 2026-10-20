---
title: Custom webhooks
description: Accept events from any system with managed or file webhooks, with signatures, a strict delivery contract, deduplication and a deliveries log.
owner: docs
section: Code forges and integrations
---

A custom webhook gives any system a URL that starts factory work: alerting tools, deploy platforms, payment providers or your own services.

## Two kinds

- **Managed webhooks** are created through the API (or the web app). Kiln generates their secret and stores it.
- **File webhooks** are `webhooks/<name>.yaml` files in the definition. Their secret is a Kiln secret you create first; Kiln never generates one for them.

```yaml
# webhooks/sentry.yaml
authMode: signature
signatureScheme: sentry
secretName: SENTRY_WEBHOOK_SECRET
deliveryIdHeader: request-id
enabled: true
```

A factory can have at most 20 webhooks, both kinds together. Each has a UID (`wh_…`) and the ingress URL `POST /webhooks/w/<uid>`. File webhooks keep the older URL `POST /webhooks/<factory>/<name>` too.

## Authentication

| `authMode` | The caller sends |
| --- | --- |
| `token` (default) | `Authorization: Bearer <secret>` |
| `url_token` | The secret as the last path segment: `/webhooks/w/<uid>/<secret>`. The URL is the credential. On the older URL, use `?token=<secret>`. |
| `signature` | The provider's signature, checked by `signatureScheme`. |

| `signatureScheme` | Header and check |
| --- | --- |
| `github` | `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the body>` |
| `pagerduty` | `X-PagerDuty-Signature: v1=<hex HMAC-SHA256>`, several comma-separated during rotation |
| `sentry` | `Sentry-Hook-Signature: <hex HMAC-SHA256 of the body>` |
| `standard_webhooks` | `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64 HMAC>` over `<id>.<timestamp>.<body>`). Svix headers are accepted. Older than five minutes is refused. |
| `stripe` | `Stripe-Signature: t=<time>,v1=<hex HMAC>`. Older than five minutes is refused. |
| `vercel` | `x-vercel-signature: <hex HMAC-SHA1 of the body>` |

The auth mode and scheme can't change after creation.

## Managing webhooks

| Call | Does |
| --- | --- |
| `GET /api/v1/factories/<id>/webhooks` | Managed and file webhooks with their URLs. |
| `POST /api/v1/factories/<id>/webhooks` | Creates one: `name`, `authMode`, `signatureScheme`, `secret`, `deliveryIdHeader`. Returns the webhook, its URL and the generated `secret`, shown once. |
| `PATCH /api/v1/webhooks/<uid>` | `enabled` and `deliveryIdHeader`. A disabled webhook answers 404. |
| `POST /api/v1/webhooks/<uid>/rotate` | Replaces the secret at once, with no overlap. For a second secret during a migration, create a second webhook. |
| `POST /api/v1/webhooks/<uid>/finish` | Stores the provider's secret and enables the webhook. |
| `DELETE /api/v1/webhooks/<uid>` | Deletes it. Automations that name it stay but stop firing. |
| `GET /api/v1/webhooks/<uid>/deliveries` | Recent deliveries. |
| `GET /api/v1/webhooks/<uid>/deliveries/<id>` | One delivery with its stored payload. |

Generated secrets start with `whsec_`. For `token` and `url_token` webhooks Kiln always generates the secret. For `standard_webhooks`, leave the secret blank and Kiln generates one to give the sender.

Stripe, Vercel, PagerDuty and other providers issue their secret only after they know the URL. Create the webhook without a secret ("create and get URL"): it starts disabled. Give the URL to the provider, then call `finish` with the secret it shows. File webhooks change only through the definition.

## Delivery rules

- `POST` only (other methods get 405). The body must be JSON (object, array or scalar), at most 256 KB. `Content-Type` is not checked.
- `202 {"delivery_id": "..."}` when accepted, even when no automation matches.
- `401` for failed authentication, `400` for invalid JSON, `404` for an unknown, disabled or deleted webhook, `413` for a body over 256 KB.
- `429` with `Retry-After` above 60 accepted deliveries a minute per webhook. Failed authentication has its own, lower budget.

Kiln identifies a delivery, in order, by: the webhook's `deliveryIdHeader`; the provider's own delivery header for signed webhooks (`X-GitHub-Delivery`, `webhook-id`, `X-Webhook-Id`, `Request-ID`, `x-vercel-id`); `X-Kiln-Delivery-Id`; or a hash of the body. A repeated delivery returns 202 with `duplicate: true` and starts nothing. Deliveries have no order guarantee, and each starts new work or none; they never continue a work item.

`deliveryIdHeader` must be a valid header name of at most 64 characters, and not one that can carry a credential, such as `Authorization` or a signature header.

## Deliveries log

Each delivery is logged with its delivery ID, size, time and status: `accepted`, `duplicate`, `rejected_auth`, `rejected_invalid_json` or `rejected_too_large`. Kiln stores the payload of accepted deliveries only. It keeps at least the last 50 deliveries and everything from the last 7 days.

## What the run receives

The work item's title comes from the payload's `title`, `summary` or `message`, or is `<name> webhook`. The body is the automation prompt plus an envelope with the webhook name, UID and delivery ID. The request body is attached as `event-payload.json` and marked as untrusted: agents read it as data and never follow instructions inside it.

## Triggering automations

Name the webhook in `webhook_ids` by file name, managed name or UID, and filter on the body with `payload`:

```markdown
---
triggers:
  - provider: webhook
    event: received
    filter:
      webhook_ids: [sentry]
      payload:
        data:
          issue:
            level: [fatal, error]
            environment: { not_in: [staging] }
---
Investigate the error and open a fix.
```

Webhook events only reach the factory that owns the webhook. The older `filter: { webhook: sentry }` still works.

### Payload filters

- Keys mirror the JSON body and combine with AND. Nested objects nest.
- A bare list means `in`. An operator object takes `in`, `not_in` and `exists`. Any other object nests further.
- Strings match exactly and case-sensitively. Numbers match numerically, so `1` equals `1.0`. Booleans and `null` can be matched.
- A missing key fails `in` and passes `not_in`. A nested pattern needs its key to exist.
- In an array of objects, any element may match. In an array of scalars, `in` means any overlap and `not_in` means none.
- Limits: at most 10 levels deep, 64 leaf fields and 32 values per list. The same value in `in` and `not_in`, or `exists: false` with a non-empty `in`, is rejected.
- A pattern that breaks these rules never matches.

### Test filter

`POST /api/v1/factories/<id>/automations/<name>/test-filter` with `{ "deliveryId": "<id>" }` evaluates the automation's triggers against a stored delivery. It returns `wouldTrigger` and, per trigger, each check (`webhook_ids`, `payload`, …) with whether it passed.

## Related pages

- [Automations](../configuration/automations.md)
- [Connections](connections.md)
- [Incident-response factory](../guides/incident-response-factory.md)
