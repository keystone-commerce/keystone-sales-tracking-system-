# Keystone Sales Operations

V1 supports two paths: agreed customer prices → confirmed order; or enquiry → pricing → quoted → confirmed order. It stops before sourcing. Includes login, role-based access, follow-ups, CSV exports and audit history.

## Local development

Node 22+ and pnpm 11. Run `pnpm install`, copy `backend/.env.example` to `backend/.env` for a new setup, then `pnpm dev`. Do not overwrite an existing environment file. Open http://localhost:3210; API port 8082. For a fresh .env copied from the example, generate and set an independent 32-byte OTP_HMAC_SECRET before starting; the existing local environment has already been prepared. See docs/OTP-LOGIN.md.

Local OTP test account: `admin@keystone.local`; code `000000` when local log-only mode is enabled. Sample seeding occurs only on an empty local database. PGlite persists under `backend/.local-data` and is forbidden in production. Keep real secrets and data outside source control.

## V1 workflow

1. Add the customer and create a customer request with SKU requirements, owner, target date, contact method and notes. Call, WhatsApp, Email, In person and Other are supported. WhatsApp/Email requests need an original message/email screenshot or PDF.
2. Choose whether prices are already agreed. Unknown prices stay NULL and display Not priced. Prices/GST can change before acceptance while in Draft, Enquiry or Pricing; SKU identities/quantities stay fixed after creation.
3. If pricing is needed, prepare prices, share the quotation externally and attach its PDF or message screenshot with the method used and quotation reference. Record quotation shared to save a revision snapshot. To revise an unaccepted quote, return to Pricing and upload evidence for the new revision.
4. Receive the customer PO: attach its image/PDF, enter the PO reference, receipt method and date. Record PO received. Accepted prices become locked.
5. Check the shipping address and mark Ready for sourcing. This is a local readiness status; no automatic handoff to the separate sourcing dashboard is connected.

The request detail shows a four-step progress tracker, communication/documents, SKU details, quotation sharing, PO receipt and readiness. Expand history entries for before/after changes, document uploads and quote revisions. Documents download through authenticated order routes.

Files: PNG/JPG/WebP/PDF, maximum 5 MB each and 20 per request. Production file bytes are stored in private S3; PostgreSQL `order_documents` stores the filename, MIME type, size, order/revision links, S3 key and version. Downloads pass through backend permissions. Local development defaults to database bytes so it works without AWS credentials; existing database files remain readable. Back up PostgreSQL metadata and protect S3 objects/version history separately. Access requires order read; uploads require order update, with a limited own-request creation exception for original communication evidence. No email/WhatsApp integration or automatic sending, quotation PDF generation, edits to existing accepted SKU lines or file deletion is implemented.

Existing legacy records retain their recorded stages/data; new requests use communication and PO evidence gates. Global sourcing, delivery, invoice and payment modules remain hidden and disabled for V1.

## Architecture and checks

Next.js 16, React 18, TypeScript, Tailwind 4, Radix/shadcn, Geist, Tabler and React Query. Express 5, PostgreSQL, jose cookie sessions and server-enforced configurable user/role/team access. Reference projects remain separate.

Run `pnpm typecheck`, `pnpm test`, `pnpm build`. The backend tests use isolated in-memory databases. Production migrations: `pnpm db:migrate`; bootstrap: `pnpm bootstrap-admin`, using protected environment variables described in the deployment guide.

## Hosting preparation

Frontend: Vercel. Backend: AWS App Runner with dedicated RDS PostgreSQL. No deployment, resource creation, GitHub push or changes to reference projects are included in this preparation.

See [V1 scope](docs/V1-SCOPE.md), [deployment preparation](docs/DEPLOYMENT.md), [access control](docs/ACCESS-CONTROL.md) and [future sourcing integration](docs/SOURCING-INTEGRATION.md).


## Additional SKUs and revised POs

After PO receipt, open the order and use Add SKUs / revise PO in the Customer PO section. Enter a reason and optional new SKU lines with agreed prices. Existing SKU IDs, quantities, prices, PO files and quotation snapshots stay unchanged. Saving creates an order revision and returns the order to Awaiting revised PO; the current PO reference/method/date reset, while the old values remain in history. Attach a new PO and record its reference, receipt method and date. The old PO cannot satisfy the new revision. Mark Ready for sourcing again after the revised PO is recorded.

Use the same action with no added items to replace only the PO. Existing accepted SKU changes/removals are not supported. Orders with sourcing, dispatch or invoice activity require coordination with operations and cannot use this amendment flow. The new PO should cover the complete revised order; amendments do not generate or send a quotation automatically.


## Automated migration releases

The local preparation in [CI/CD migrations](docs/CI-CD-MIGRATIONS.md) uses a deployment CodeBuild job followed by a separate VPC migration job running the exact release image. App Runner updates only after migrations succeed. Source ZIP packaging is available through scripts/package-ci.ps1 without a GitHub push. AWS roles, projects, source bucket, VPC access and migration secret must still be configured; no cloud job has been run. New numbered SQL files are discovered automatically and applied once.


## Email OTP sign-in

The login screen now uses email → six-digit code → session. See [OTP setup](docs/OTP-LOGIN.md) for local testing, real Gmail OAuth delivery and production secrets. New users need an email and access assignments, with no initial password. Production requires OTP and rejects local fixed-code/log-only options. Database migration 009_email_otp is applied before deployment.


## First production admin

The separate manual [one-time bootstrap job](docs/BOOTSTRAP-ADMIN.md) is prepared for yashraj@keystonecommerce.in as Admin. It runs only after migrations, using a verified backend image and a protected RDS connection. It is not part of normal releases and has not been created or run in AWS.
