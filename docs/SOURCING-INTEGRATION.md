# Existing sourcing application handoff

## What exists today

`sourcing_links` stores one reference per SKU line within a Sales Ops order: external reference, manually recorded status, supplier display name, expected supply date and handoff notes. It does not create supplier POs or compare vendor quotations. The UI states that it is manual. Set `SOURCING_PORTAL_URL` on the backend to enable the link to the existing dashboard.

`GET /api/integrations` reports `apiConnected: false`. No button or background process pretends the sourcing API is connected.

## Contract needed from the existing project

Confirm the repository/service responsible for sourcing and provide its API documentation or relevant routes. Agree:

1. How a sales-order line becomes a sourcing request: automatic on confirmation, or an explicit employee action.
2. The stable IDs: `sales_order_id`, `sales_order_item_id`, originating application, and external sourcing request ID. Do not match on free-text product names.
3. Which application owns supplier selection, quoted cost, supplier PO, supply ETA and readiness. Sourcing should own those fields; Sales Ops reads them.
4. Authentication: dedicated service identity with narrow permissions; never copy browser session tokens or share database credentials.
5. Delivery model: signed webhooks or incremental polling. Include event ID, event time, record version and replay protection. Handle retry, duplicates and out-of-order events.
6. Status mapping, cancellation, split sourcing across suppliers, partial readiness, and updates after dispatch.
7. Who can manually resolve integration failures and where failures are visible.

## Proposed flow (requires agreement)

Confirmed sales order → transactional outbox → sourcing request API → external request ID saved here → signed status event → idempotent inbox → read-only sourcing projection → fulfilment team.

This proposal is not implemented. Add BullMQ/Redis only if needed for reliable dispatch/retry, following the Team Portal's durable outbox pattern. Store synchronization attempts and failures; preserve manual entry as a clearly distinguished fallback.

## Manual API now available

Authenticated `POST /api/sourcing`: `order_id`, `order_item_id`, `external_ref`, `status` (`Requested`, `In progress`, `Ready`, `Blocked`), optional `supplier`, `eta`, `notes`. Sales/admin only. `PATCH /api/sourcing/:id` updates status details with the current `version` to prevent stale overwrites. Updates are auditable. These are internal UI endpoints, not a trusted external webhook contract.
