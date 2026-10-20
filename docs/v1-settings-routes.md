# V1 Settings Routes

URI versioning. With `API_VERSION=1`, paths start with `/v1`. All routes
require a Firebase ID token; the uid is derived from the token and never read
from the body.

## Auto archive

The account-level preference for how long alerts stay in the Active list before
moving to Archived. Stored on `profiles/{uid}.autoArchiveHours`. Allowed values
are `24`, `48`, `72`, or `null` (Never). A missing field means Never.

### GET /v1/settings/auto-archive

```json
{ "autoArchiveHours": 48 }
```

### PATCH /v1/settings/auto-archive

Body:

```json
{ "autoArchiveHours": 48 }
```

Use `{ "autoArchiveHours": null }` to disable (Never). Any other value returns
`400`. The response echoes the saved preference. The preference is merged into
the profile document without overwriting other fields, and it applies
retroactively to every still-unarchived alert (deadlines recompute from each
alert's original `createdAt`). Already-archived alerts stay archived.
