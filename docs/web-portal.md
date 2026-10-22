# Web portal API foundation

This module shares the existing Firebase Auth and Firestore services. It does not create a second account database. All paths below use the existing `/v1` prefix and success envelope.

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/v1/web/session` | Verified Firebase ID token plus active web role and membership |
| `POST` | `/v1/web/applications` | Public, validated, rate limited by the existing global throttle |
| `GET` | `/v1/web/applications` | `admin` or `system_admin` custom claim |
| `PATCH` | `/v1/web/applications/:id/review` | Administrator |
| `GET` | `/v1/web/organization` | Active organization membership |
| `GET` | `/v1/web/incidents` | Own assigned organization, or administrator oversight |
| `GET` | `/v1/web/incidents/:id` | Own assigned organization, or administrator oversight |
| `PATCH` | `/v1/web/incidents/:id/status` | Assigned organization or administrator |
| `POST` | `/v1/web/incidents/:id/notes` | Assigned organization or administrator |
| `GET` | `/v1/web/locations` | Active organization membership; simulation fixtures only at present |
| `GET` | `/v1/web/audit` | Administrator |

Application approval records the reviewer and time and creates an active organization record. It sets `activationStatus=awaiting_account_setup`; it **does not** create or email an account. A verified activation and invitation delivery workflow is still required. The existing backend has no organization account email transport or secure document upload service. Do not treat approval as account activation.

The incident and location collections are new web portal records. Existing mobile alerts are user scoped, and no mobile-to-organization incident pipeline exists yet. The web API does not republish or expose those driver alerts. Production work must link the shared alert/SOS pipeline to assigned incidents and authorize location sessions server side.

## Isolated demonstration seed

The seed script refuses staging and production, requires `RIDEGUARD_WEB_DEMO_SEED=true`, and requires both Firebase emulators or a project ID containing `demo`. It does not change existing account passwords or touch records lacking `demo: true`.

In a separate local development Firebase project, configure the backend `.env` and run:

```sh
RIDEGUARD_WEB_DEMO_SEED=true RIDEGUARD_WEB_DEMO_PASSWORD='set-a-dev-password' RIDEGUARD_WEB_DEMO_ADMIN_PASSWORD='set-another-dev-password' npm run seed:web-demo
```

Use equivalent environment variable assignment on Windows. `npm run seed:web-demo -- --remove` removes only marked demo records and accounts. This has not been run against Firebase in this change; only compilation and mocked authorization tests have passed.

The fictional accounts are Maria Santos (`barangay34@demo.rideguard.local`), Juan Dela Cruz (`responder34@demo.rideguard.local`), and the demo administrator (`admin@demo.rideguard.local`). Seeded incidents `RG-DEMO-001` through `003` and the map point are simulation records only.
