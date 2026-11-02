# Deployment target: AWS API + Vercel frontend

No deployment has been performed. Reuse the **architecture** of Team Portal, not its database, user records, secrets or live infrastructure configuration. A dedicated Sales Ops service/database avoids changing the running portal.

## AWS backend

1. Provision a dedicated PostgreSQL 17 RDS database in private subnets with encryption, backups, deletion protection and an application role with DML-only table/sequence grants. Use a migration/admin role only for migrations. Verify a restore before production use.
2. Use App Runner (matching Team Portal) with a VPC connector to access RDS. Restrict database inbound traffic to the application/migration security groups. Supply network egress needed by future integrations.
3. Store `DATABASE_URL` and a new random `JWT_SECRET` (32+ characters) in SSM SecureString or Secrets Manager. Bind via the App Runner instance role; do not put values in source or image build arguments.
4. Backend configuration:

   ```text
   NODE_ENV=production
   PORT=8080
   FRONTEND_ORIGIN=https://YOUR_SALES_OPS_FRONTEND
   DATABASE_URL=<secret: dedicated sales_ops runtime connection>
   DATABASE_CA_FILE=/app/certs/rds-ca.pem
   JWT_SECRET=<secret: new independent key>
   DEV_EMBEDDED_DB=false
   DEV_SEED=false
   RELEASE_SCOPE=pre-sourcing
   DOCUMENT_STORAGE=s3
   AWS_REGION=YOUR_REGION
   S3_DOCUMENT_BUCKET=YOUR_PRIVATE_BUCKET
   ```

   `FRONTEND_ORIGIN` must be the exact scheme/host/port, without a trailing slash. Use the included public AWS RDS regional CA bundle (copied from the existing Team Portal) and refresh it on AWS CA rotations. TLS verification remains enabled. Do not put conflicting `sslmode` or SSL query parameters in the database URL.

5. Build from `backend/`:

   ```powershell
   docker build -t keystone-sales-ops-api:RELEASE_TAG backend
   ```

   Push an immutable release tag to the chosen private ECR repository. Configure App Runner to use that image, port 8080 and HTTP health path `/readyz`. `/healthz` is liveness only. Runtime is non-root. `package-lock.json` pins backend npm dependencies for the container. No embedded database or sample seeds are installed in the production image.

6. Before starting an API version that needs a new schema, run `node src/manage.js migrate` as a one-off job with the migration role and verified RDS TLS. Migrations run in an advisory-locked transaction with a ledger. Production API startup does not mutate schema automatically.
7. Create the first production admin with the dedicated one-time CodeBuild job in [BOOTSTRAP-ADMIN.md](BOOTSTRAP-ADMIN.md), running `node src/manage.js bootstrap-admin-once` after migrations. The prepared email is `yashraj@keystonecommerce.in`, role `admin`. The database connection comes from a protected bootstrap secret; no password or Gmail settings are needed for this task. Add later users through Admin access.
8. Use CloudWatch logs/alarms for errors, latency, RDS storage and connections. The pool is capped at five connections per instance. Run one instance initially; shared/global login throttling and concurrency checks against the deployed RDS engine are required before horizontal scaling. Current login rate limiting is process-local.

## Vercel frontend

Import this project's root as a Next.js project. Node 22, install `pnpm install --frozen-lockfile`, build `pnpm build`. Set the server-side Vercel variable:

```text
BACKEND_ORIGIN=https://YOUR_APP_RUNNER_SERVICE_ORIGIN
```

Never expose `DATABASE_URL` or `JWT_SECRET` through `NEXT_PUBLIC_` variables. Next.js rewrites `/api/:path*` to AWS, so browser cookies remain associated with the frontend origin. This configuration intentionally requires HTTPS for production API origins and fails a Vercel build without a backend origin. Set `FRONTEND_ORIGIN` on the API to the Vercel production/custom domain.

Preview deployments need a matching backend/frontend-origin pair with separate preview data; don't weaken Origin checks or point uncontrolled previews at production.

## Acceptance before live data

Verify HTTPS session cookies through Vercel, login/logout, live role revocation, customer creation, draft multi-SKU orders, confirmation evidence, follow-ups, exports and audit history. Verify sourcing/delivery/invoice/payment screens are absent and their write/export APIs return 404 even for administrators. No sourcing URL or credentials are needed in V1.

Verify RDS TLS, container health checks, a database restore and release rollback. Use a dedicated empty production database with sample seeding disabled. Commercial SKU correction/versioning and a separate enquiry/quotation pipeline remain deferred.

Preparation only: do not create resources, upload images, deploy or push until authorized. A future Vercel CLI deployment can use local source without connecting GitHub.


## Communication and PO evidence

Apply all migrations, including 008_s3_documents, before starting this version. Production requires DOCUMENT_STORAGE=s3, S3_DOCUMENT_BUCKET and AWS_REGION. Metadata remains in PostgreSQL; new file bytes go to private S3. Local development defaults to database storage and existing database uploads remain readable. Existing files are not moved automatically.

Create a dedicated private bucket with Block Public Access enabled, bucket-owner-enforced Object Ownership, default encryption and versioning. Preserve recorded object versions in retention/lifecycle rules. Do not add public-read ACLs. Grant the App Runner instance role s3:PutObject, s3:GetObject, s3:GetObjectVersion, s3:DeleteObject and s3:DeleteObjectVersion only on arn:aws:s3:::YOUR_BUCKET/sales-ops/documents/*. Delete permissions support cleanup after failed metadata saves. If the bucket uses SSE-KMS, grant the corresponding KMS key permissions. Use the instance role rather than static access keys. See S3-INSTANCE-POLICY.example.json.

With a VPC connector, provide an S3 gateway endpoint on its subnet route tables or suitable NAT egress. Test upload/download through the real frontend, including size/time limits. Objects use generated keys under sales-ops/documents/ORDER_UUID/DOCUMENT_UUID. SQL stores bucket/key/version and metadata; the backend fetches the recorded object/version after checking order permissions. File lists do not expose raw storage locations.

Back up database metadata and protect S3 objects/version history together. Database backups alone do not contain production file bytes. Verify real bucket permissions, versioned downloads and restore before deployment. No bucket or other AWS resource has been created.

Order amendments require migrations 006_order_amendments and 007_accepted_revision. Verify additional-SKU and PO-only revisions, retention of previous PO downloads, stale edits/uploads, duplicate SKUs, rollback and readiness gating before deployment. Revised POs are associated with an order revision and cannot reuse previous revision evidence.


## Automatic pre-deployment migration option

See CI-CD-MIGRATIONS.md and backend/ci/ for locally prepared buildspecs and CodeBuild project examples. The release image is built/tested/pushed, a dedicated VPC job verifies its digest and applies pending SQL using the migration identity, and the parent deploys only after success. Bootstrap mode initializes the database before first App Runner creation. Roles/projects and a trusted source trigger are not provisioned yet. CI/CD does not reverse schema changes on API rollback.


## Email OTP production settings

Apply 009_email_otp and configure AUTH_MODE=otp, OTP_LOG_ONLY=false, OTP_HMAC_SECRET, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_SENDER_EMAIL and optional GMAIL_SENDER_NAME on App Runner. Leave OTP_DEV_FIXED_CODE unset. Store sensitive values in Secrets Manager/SSM; use an independent OTP secret and do not expose it or Gmail credentials in Vercel. Give the runtime database user DML access to the new OTP tables. Gmail OAuth requires internet/NAT egress from the VPC connector. The migration job does not require mail credentials. Before deployment, verify actual OTP email delivery and disabled-user/role revocation. See OTP-LOGIN.md.
