# Customer order to supplier payment

The expanded workflow is available when the backend uses RELEASE_SCOPE=full. Existing pre-sourcing and manual-sourcing settings retain their release boundaries.

## Activation

Apply the numbered migrations through the existing migration release job before starting the backend. Migration 021 adds supplier purchasing tables and permissions without changing existing orders or sourcing references. Enable RELEASE_SCOPE=full on the backend after the frontend and API changes are available.

Administrators can open Supplier purchasing and configure two different active approvers under Approval settings. The initial threshold is INR 50,000. Requests above the threshold need primary approval followed by secondary approval. Requests at or below it need primary approval. Each request stores its assigned approvers, so policy changes apply to new requests.

The Administrator role receives all five procurement permissions. Members receive procurement.read and procurement.create. Use existing Admin access to grant procurement.approve or procurement.pay to the appropriate users or custom roles, together with procurement.read. Requesters must differ from all assigned approvers. Administrators follow the same assigned-approver rule. No extra built-in roles are created.

Full-scope dispatch, invoice, and receipt permissions already exist. Assign them through Admin access to the responsible logistics and finance users.

## Migration and release pipeline

The existing Dockerfile copies backend/migrations into the backend image. The backend release build runs tests, builds and pushes an immutable image, and starts the dedicated migration job with that image and its expected digest. The migration job runs node src/manage.js migrate, which discovers numbered SQL files automatically. Migration 021 therefore needs no new pipeline entry. Pending migrations run under the existing transaction/advisory lock and are recorded in schema_migrations, so successful migrations are skipped on retries.

The release script waits for migration success before updating App Runner. A failed migration stops that update. App Runner startup itself does not run production migrations. Database migrations are not automatically reversed if a subsequent application deployment fails.

The production handover documents a main-branch webhook for backend changes. This implementation verifies the repository pipeline code, not current AWS webhook credentials or deployed job configuration. After merging, confirm that the release job starts, its migration phase reports 021_supplier_payments applied (or already applied), the App Runner update succeeds, and /readyz returns ready. Vercel runs independently and must also complete successfully.

Keep the current release scope during the initial rollout. Once both deployed applications are verified, an authorized operator should update the backend's existing RELEASE_SCOPE setting to full, retaining its other runtime settings, and wait for the configuration deployment to finish. Then assign purchasing/logistics/finance permissions and configure approvers using the steps above. The release script preserves App Runner's existing environment configuration; merging the PR does not change RELEASE_SCOPE automatically.

## Daily workflow

1. Complete the existing customer enquiry, pricing/quotation evidence, and customer PO steps. Mark the current order revision Ready for sourcing.
2. Open Supplier purchasing. Add a supplier and record competing quotations against an order SKU. Existing manual sourcing records remain available separately.
3. Select a quotation, enter the supplier PO reference and quantity, and record the selection reason. PO prices are copied from the selected quotation. Split purchasing across suppliers is supported, with total committed quantity capped at the customer SKU quantity. Each supplier PO currently covers one SKU.
4. Attach supplier quotation/PI/PO evidence under the purchase order's Documents action.
5. Raise an independently referenced payment request against the PO. Pending and approved requests reserve their full amounts. Rejected and cancelled requests release their reservations. Rejected requests can be replaced with a new request reference.
6. The assigned approver opens Payment requests and approves or rejects with a reason. High-value requests remain pending until the secondary approver decides. The requester can cancel a pending request with a reason.
7. Finance records a completed bank transfer against an approved request, including the UTR, date, method and optional bank/accounting reference. Partial payments are supported. Upload payment proof under the payment's Documents action.
8. Use the existing Dispatch & delivery register to record consignments and per-SKU delivery/POD outcomes.
9. Use Invoices and Payment receipts to record customer billing and collections. Customer receipts and supplier payments are separate records.
10. Raise further supplier requests and record balance payments under the same policy.

The application records supplier POs and completed bank transfers. Supplier PO sending and bank transfer initiation are external actions. GST filing, automatic sourcing portal synchronization, supplier PO amendment/cancellation, and edits to recorded supplier bank details are outside this implementation. Supplier and purchasing records are retained as entered. Review incorrect records before proceeding with dependent transactions.

## Integrity and documents

Amounts use integer paise. Purchase allocations serialize on the sales order. Requests serialize on their supplier PO. Approval decisions and payments serialize on the request. Unique bank references and payment submission IDs prevent duplicate payment entries, including retries of the same submission. Accepted orders with supplier POs cannot be cancelled or amended through the pre-sourcing amendment action.

Supplier documents reuse the existing 5 MB PDF/image validation and private document storage configuration. There are up to 20 documents per linked PO, request, or payment. Downloads require live procurement.read permission. Failed uploads leave no document metadata or audit entry and attempt to remove uncommitted S3 object versions after checking whether metadata committed.

## Validation

Run pnpm typecheck, pnpm test, and pnpm build. The purchasing regression tests exercise the modern customer PO workflow, approvals, payment retries, quantities, reservation balances, document access and S3 rollback cleanup using isolated embedded databases. scripts/procurement-browser.mjs exercises the purchasing screens with an isolated database and writes desktop/mobile screenshots to work/.
