# Local verification — 29 October 2026

Sales Ops runs at http://localhost:3210; its API runs on port 8082. Team Portal files were not modified.

- `pnpm test`: 15/15 passed, including authorization, the original single-SKU workflow, multi-SKU shipments/invoices/receipts, per-SKU limits, competing writes, stale edits, proof/date checks, monetary rounding and migration compatibility.
- `pnpm typecheck`: passed after multi-SKU and UI-copy changes.
- `node scripts/browser-check.mjs`: passed at port 3210 for the original single-SKU workflow.
- `node scripts/multi-sku-browser.mjs`: passed after the final UI changes. Covered adding/removing SKU rows, two GST rates, per-SKU dispatch and delivery, invoice-prefill and partial quantities, receipt allocation, invoice/shipment line inspection, sourcing each SKU, search by the second SKU, mobile dialog layout and overship rejection. No browser runtime errors were captured.
- Desktop and 390px mobile screenshots visually inspected. Wide SKU tables scroll within their own containers; shared order fields fit the mobile dialog.
- Local database migration compared against `work/backups/before-multi-sku.json`: all existing record IDs, order quantities, invoice amounts, receipts, outstanding balances and audit entries preserved.
- Browser-created test records removed afterward. Original sample records retained.

UI copy was reduced to essential headings, labels, totals, statuses, errors and actions. Manual integration modes remain visible in workspace settings. No deployment, GitHub push, AWS resource mutation, real payment, courier integration or automatic sourcing synchronization was performed.
- Final pnpm build: passed (compilation, TypeScript and page generation).

## Configurable RBAC update

- 21 backend tests passed after the access-control changes.
- Access-management browser checks passed, including roles, direct permissions, teams, restricted datasets/actions, revocation, deactivation and mobile layout.
- The multi-SKU browser workflow passed with RBAC enabled.
- Final pnpm build passed: compilation, TypeScript and page generation.
- Pre-RBAC business rows, user credentials and audit history were preserved. Test accounts, roles, teams and transactions were removed.
- Reference backend/admin projects were read only; no deployment, commit or push was performed.


## V1 before sourcing — 2026-10-30

- `pnpm typecheck`: passed.
- `pnpm test`: 22/22 passed, including administrator V1 API gating, workspace/export projection and preservation of deferred records. Full-workflow regression tests explicitly opt into the future `full` backend scope.
- `pnpm build`: passed.
- `node scripts/v1-browser.mjs`: passed for hidden deferred navigation, approval overview, order details/actions/SKU columns, new-order dialog and mobile overflow at 390px. Browser page errors: none. Read-only checks used the local sample account.
- Deployment configuration remains Vercel frontend + AWS backend, with pre-sourcing scope by default. No remote resources, deployment or GitHub push performed. Real RDS/container/Vercel session behavior remains a deployment-stage validation.


## Both pricing scenarios — 2026-10-31

25 backend tests pass, including nullable prices, confirmation gates, price locks, quotation snapshots/revisions, stale edits and invalid line edits. Production build passed. Isolated browser checks passed for direct agreed-price confirmation and enquiry → pricing → quoted → confirmed, unknown totals, locked quoted prices, revision display and mobile layout. Existing local orders were migrated and the frontend/API verified at localhost:3210. The form asks “Has the customer agreed to the price?” using plain-language choices. Quotations are shared manually outside the app; no automatic sourcing integration or sending is implemented. Nothing deployed or pushed.


## Request history and form order — 2026-10-31

The customer price-agreement question follows the main request details. Per-order history is available to users with orders.read via GET /api/orders/:id/history, independently of global audit access. It returns only that order's whitelisted sales fields and quotation snapshots. New create/update audit events retain immutable before/after snapshots transactionally; older logs are labelled as limited details. History and quotation revisions expand inside the request detail dialog. Deferred module fields and unrelated access activity are excluded.

27 backend tests passed, including history isolation, authorization, before/after price snapshots, rollback and legacy filtering. Browser tests passed field position, history expansion, quotation expansion, both pricing paths and mobile overflow. TypeScript passed. No user test records were created by browser checks (isolated database). Existing local history endpoint verified with HTTP 200.


## Guided customer communication, quotation and PO — 2026-10-31

30 backend tests passed, including source evidence, quotation revision evidence, PO attachment/method/date gates, readiness sequencing, binary download integrity, invalid/oversized uploads, anonymous/unauthorized access and cross-order isolation. Existing role, SKU, pricing, history and financial regressions remain green. Production build and TypeScript passed. `node scripts/workflow-browser.mjs` passed the call/agreed-price route and email/unpriced enquiry route end to end through quotation evidence, PO received, Ready for sourcing, history and mobile overflow. Browser checks use an isolated database and did not add user test records.

Existing local records were preserved by migration 005_request_evidence; the local workspace includes request_channel and the document API returns HTTP 200. Files persist in order_documents bytea with metadata and require live order read permissions to download. The guided flow is for new requests; legacy records retain earlier recorded stages/data and are not retroactively assigned communication or PO evidence. Ready for sourcing does not submit externally. No deployment/push.


## Additional SKUs and revised PO — 2026-10-31

32 backend tests passed. Amendment checks cover new SKU insertion without changing accepted items, PO-only revisions, version conflicts, duplicate codes, missing/new-revision PO evidence, stale uploads, immutable prior PO downloads, before/after history, readiness reset and linked-operations blocking. After splitting accepted_revision into migration 007, the five evidence/amendment tests and eight access tests passed again, including read-only denial on the amendment endpoint. Build and TypeScript passed.

The isolated browser flow passed adding five white kettles to an accepted ten-black-kettle order, verifying revised total INR 18,880, sourcing readiness disabled, requiring a new PO, retaining both PO files and restoring readiness after receipt. Existing call/agreed and email/quotation/PO routes and mobile overflow also passed. No browser test data added to the local user database.


## Private S3 document storage — 2026-11-01

37 backend tests pass, including five mock-S3 cases: S3 bytes with SQL-only metadata/version, authenticated version-specific downloads, legacy database file compatibility, storage-failure rollback and exact-version cleanup after a metadata failure. Production config requires S3 bucket and region, with no silent database fallback. Existing local/test storage defaults to database and is preserved. TypeScript and production build pass. Both pnpm and backend npm lockfiles include the AWS SDK. No real AWS requests, bucket creation, migration of local files, deployment or GitHub push performed. Real IAM, bucket encryption/versioning, VPC endpoint access, file transfers and coordinated metadata/object restore remain deployment checks.


## Automated migration pipeline preparation — 2026-11-02

42 backend tests passed, including migration-before-deploy ordering, failed/stopped/timed-out migration gates, bootstrap mode, resource mismatch rejection, readiness failure, SQL discovery/order, applied-name skipping, whole-file function/quoted-semicolon handling and transaction rollback. Focused migration tests and an isolated in-memory manage.js migrate CLI check passed after adding applied/skipped log output. TypeScript passed. Both buildspec YAML files parse and their Bash scripts pass syntax checks. The generated work/sales-ops-ci-source.zip contains only allowlisted backend code/tests/configuration and no environment files, local database, user uploads or Git metadata. Team Portal production CI files were read only; no reference project was changed. No AWS job/resource, production database operation, deployment or push occurred. Live CodeBuild Docker/IAM/VPC/RDS checks are pending setup.


## Email OTP sign-in — 2026-11-02

50 backend tests pass, including eight OTP/Gmail cases covering hashes, expiry, single use/concurrent verification, attempt lockouts, shared resend quotas across app instances, email binding, disabled/unknown accounts, cookie/RBAC/logout, delivery failures, production local-shortcut guards and mocked Gmail OAuth/MIME/caching. Focused OTP tests passed after the final configuration guard. Browser tests passed the email/code flow, wrong code, cookie login/logout, resend cooldown, change email, password-free user creation and mobile overflow using an isolated database and mock mailer. TypeScript and the production build passed. CI source ZIP was regenerated with migration 009 and the new source; no local environment data was packaged. Reference admin panel/backend were read only. Actual Gmail delivery awaits user-supplied credentials; no real email, AWS job, deployment or GitHub push occurred.
