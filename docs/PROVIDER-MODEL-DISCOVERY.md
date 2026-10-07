# Provider key model discovery

The account-scoped `GET /api/v2/inference/credentials/:id/models` lists models
returned by the provider using the saved credential. It uses free metadata GETs,
not inference. It does not change a key's status, model restrictions, routing,
last-used timestamp, or the user's XENO balance. Provider secrets remain inside
the existing vault callback and never appear in the response.

Catalogs are bounded by page count, response bytes, model count, and a whole-call
deadline. Connections retain the existing HTTPS/SSRF/DNS protections. Only model
IDs and numeric token limits are returned. Model listing is not proof that a paid
inference would succeed or that credits remain. Pass-through keys still require
an explicit saved model allow-list, and routing still requires the user to select
the key for their account or product. Discovery never silently enables it.

## Deployment against a live image

The current production backend has two replicas and host-local runtime wiring.
For this additive route change, preserve the exact running image as the parent,
verify the three existing changed files match the reviewed baseline, and build
a child image containing only the committed discovery changes. Keep the current
Compose definition and its environment unchanged. Test the candidate before
recreating backend replicas; preserve the original image for rollback and check
each replica plus `/api/ready` after swap. No database migration is needed.
