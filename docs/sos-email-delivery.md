# SOS email delivery

RideGuard sends SOS email notifications from the backend, alongside SMS
submissions. The mobile app never contains SMTP credentials and never sends
email directly. This document describes the server-side email sender and how it
fits into the SOS flow.

## Sender

`src/infra/email/sos-email.sender.ts` exports:

- `SOS_EMAIL_SENDER` — NestJS injection token (`Symbol`).
- `SosEmailSender` — provider-neutral interface with `sendStart` and `sendEnd`.
- `NodemailerSosEmailSender` — the concrete implementation, injected into
  `SosService` through the `SOS_EMAIL_SENDER` token (bound with `useExisting`).

`NodemailerSosEmailSender` builds a Nodemailer transporter from SMTP config and
sends two email kinds:

| Kind | Subject | Trigger |
| --- | --- | --- |
| Start | `RideGuard SOS - {rider name}` | SOS activated |
| End | `RideGuard SOS ended - {rider name}` | SOS stopped |

Email body includes the rider name, the event timestamp, the captured SOS
location, and a Google Maps link when a location exists:

`https://www.google.com/maps/search/?api=1&query={latitude},{longitude}`

When no location exists, the email states that location was unavailable and
omits the map link. Notification is preferred over suppressing the email, so an
SOS without a location still produces an email.

## Configuration

SMTP is read from environment variables through `ConfigService`. These variables
are present in `.env.example` but are not in the Joi validation schema
(`src/config/env.validation.ts`), so SMTP is optional at boot:

| Variable | Example | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` | Required to enable email |
| `SMTP_PORT` | `587` | Defaults to 587 |
| `SMTP_SECURE` | `false` | `true` only for port 465 |
| `SMTP_USER` | `your-app-account@rideguard.ph` | Required to enable email |
| `SMTP_PASS` | app password | Required to enable email |
| `SMTP_FROM` | `"RideGuard" <noreply@rideguard.ph>` | Defaults to RideGuard noreply |

When `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is unset, the transporter is
`null` and `NodemailerSosEmailSender` throws `SOS email delivery is not
configured` at send time. `SosService` injects the sender with `@Optional()`,
so an unconfigured sender degrades gracefully: SMS still works, activation is
not blocked, and email status is recorded as `failed` with `email_unavailable`
rather than failing the whole SOS.

## Delivery semantics

Email work is queued on the backend after the SOS record is durably accepted.
Mobile SOS activation is not blocked on SMTP completion.

Per-recipient start and end email outcomes are tracked independently of SMS:

- `initialEmail` — start email status
  (`queued | sending | sent | failed | unknown`)
- `endedEmail` — end email status
  (`queued | sending | sent | failed | unknown | null`)

A successful SMS submission does not imply successful email delivery, and vice
versa. Recovery after restart resumes interrupted `sending`/`queued` email work
using the same bounded retry policy as SMS delivery.

Transient provider failures are retried with a bounded policy keyed on
`sosId`, recipient ID, and message kind. The mobile app does not automatically
resend after an ambiguous result.

Full email addresses, message bodies, map URLs, and location coordinates are not
logged in normal application logs.

## SOS response contract

Each public SOS recipient now includes:

- `email` — the contact's email address
- `initialEmail` — start email submission summary
- `endedEmail` — end email submission summary, or null

See `docs/v1-sos-routes.md` for the full response contract.
