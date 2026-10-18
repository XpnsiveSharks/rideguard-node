# Emergency contacts and photos

Cloudinary is used because no CDN provider was configured in the backend and it
provides managed image delivery plus deletion by `public_id`. Uploads are
server-side signed with the API secret; Firestore stores only `photo_url` and
`public_id`. Firebase Authentication remains unchanged.

All routes require `Authorization: Bearer <Firebase ID token>` and are prefixed
with `/v1`. Successful responses use the standard envelope:
`{ "success": true, "message": "...", "data": ..., "timestamp": "..." }`.

| Method | Path                              | Request                                                                                                                                   | Response data                                                                          |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/profile/me`                     | none                                                                                                                                      | Profile document, including `photo_url` and `public_id` when present.                  |
| POST   | `/profile/photo`                  | multipart `photo`; JPEG/PNG/WebP, <= 5 MB                                                                                                 | `{ "photo_url": "https://res.cloudinary.com/...", "public_id": "profile-photos/..." }` |
| GET    | `/profile/emergency-contacts`     | none                                                                                                                                      | Contact array.                                                                         |
| POST   | `/profile/emergency-contacts`     | multipart `name`, `phone` (`+639xxxxxxxxx`), `relationship` (`Parent`, `Sibling`, `Spouse`, `Child`, `Friend`, `Other`), optional `photo` | Created contact with `photo_url` and `public_id`, or null values.                      |
| GET    | `/profile/emergency-contacts/:id` | none                                                                                                                                      | One owned contact; another user's ID returns 404.                                      |
| PATCH  | `/profile/emergency-contacts/:id` | multipart changed fields and optional `photo`                                                                                             | Updated contact; replacing a photo deletes the old Cloudinary asset.                   |
| DELETE | `/profile/emergency-contacts/:id` | none                                                                                                                                      | Empty `data` object; another user's ID returns 404.                                    |

Photo failures return `400` for a missing/unsupported file or a file over
`PROFILE_PHOTO_MAX_BYTES` (5 MiB). Missing/invalid authentication returns 401.

The reversible migration is:

```powershell
npx ts-node scripts/migrate-emergency-contacts.ts up
npx ts-node scripts/migrate-emergency-contacts.ts down
```

`up` creates one marked contact for each legacy embedded contact and removes
`profiles/{uid}.emergencyContact`; `down` restores the saved legacy object and
deletes only contacts carrying the migration marker.
