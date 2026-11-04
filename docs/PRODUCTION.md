# Production deployment

Deployment date: 4 November 2026. AWS account: `415407325762`, region: `ap-south-1`.

- Frontend: https://keystone-sales-tracking-system.vercel.app
- Backend: https://dqkrr34f3n.ap-south-1.awsapprunner.com
- Readiness: https://dqkrr34f3n.ap-south-1.awsapprunner.com/readyz
- First administrator: `yashraj@keystonecommerce.in`, using email OTP.

## Environment settings

Keep development settings in the ignored `backend/.env`. Production settings live in App Runner and SSM, not in a committed environment file. The supplied development file was not modified.

| Setting | Local development | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `8082` | `8080` |
| `FRONTEND_ORIGIN` | `http://localhost:3210` | `https://keystone-sales-tracking-system.vercel.app` |
| `DEV_EMBEDDED_DB` | `true` | `false` |
| `DEV_SEED` | `true` | `false` |
| `DOCUMENT_STORAGE` | `database` | `s3` |
| `DATABASE_URL` | Not needed with embedded DB | SSM `database-url` |
| `DATABASE_CA_FILE` | Not needed with embedded DB | `/app/certs/rds-ca.pem` |
| `RELEASE_SCOPE` | `manual-sourcing` | `manual-sourcing` |
| `AUTH_MODE` | `otp` | `otp` |
| `OTP_LOG_ONLY` | `false` for real email | `false` |
| `OTP_DEV_FIXED_CODE` | Optional only with local log-only mode | Unset |
| `AWS_REGION` | Not needed for database document storage | `ap-south-1` |
| `S3_DOCUMENT_BUCKET` | Not needed for database document storage | `keystone-sales-tracking-docs-415407325762-ap-south-1` |

App Runner references SecureString parameters under `/keystone/sales-ops/production/`:

| Environment variable | Parameter suffix |
| --- | --- |
| `DATABASE_URL` | `database-url` |
| `JWT_SECRET` | `jwt-secret` |
| `OTP_HMAC_SECRET` | `otp-hmac-secret` |
| `GMAIL_OAUTH_CLIENT_ID` | `gmail-oauth-client-id` |
| `GMAIL_OAUTH_CLIENT_SECRET` | `gmail-oauth-client-secret` |
| `GMAIL_OAUTH_REFRESH_TOKEN` | `gmail-oauth-refresh-token` |
| `GMAIL_SENDER_EMAIL` | `gmail-sender-email` |
| `GMAIL_SENDER_NAME` | `gmail-sender-name` |

JWT and OTP production secrets were independently generated. Gmail settings came from the supplied file. App Runner uses an IAM instance role for S3 and parameter access; do not configure static AWS credentials.

Vercel has only this application environment variable, scoped to Production:

```dotenv
BACKEND_ORIGIN=https://dqkrr34f3n.ap-south-1.awsapprunner.com
```

Locally, set `BACKEND_ORIGIN=http://127.0.0.1:8082` in the ignored root `.env`. Do not point preview deployments at production data. Redeploy Vercel after changing `BACKEND_ORIGIN`, because Next.js builds the rewrite destination into its output. Redeploy App Runner after updating referenced SSM values.

## Existing resources and first release

Reused the existing ECR repository, image-build project, RDS database, attachment bucket, GitHub connection, private subnets and NAT. No additional database, bucket, ECR repository or NAT gateway was created.

- ECR: `415407325762.dkr.ecr.ap-south-1.amazonaws.com/keystone-sales-tracking-api`
- Initial backend source: `08294d003a65045d5d09462a17c64724a8913ee8`
- Initial image tag: `release-d50a993b-dbfb-4af4-9b2d-4730a0c3bbb2`
- Initial image digest: `sha256:4fc829615ec47959dab70e6ad4d1a70fa73cdfafeeb1e97191c21088dff71bcd`
- Successful migration build: `keystone-sales-ops-migrations:6e89d741-8c1b-41f6-aee0-6213483739fe`
- Successful admin bootstrap build: `keystone-sales-ops-bootstrap-admin:e76082b7-d8d5-4ea6-bb8d-26461fed60c0`
- App Runner ARN: `arn:aws:apprunner:ap-south-1:415407325762:service/keystone-sales-tracking-api/d6cf6b2a6f0b49f7b92aff307e0dd649`

All 17 migrations were applied before service creation. Bootstrap created the first admin without sample business data. Bootstrap IAM permissions and its temporary SSM parameter were removed after success; the project and logs remain for audit and cannot be rerun without restoring access.

## Network and access decisions

With explicit approval, CodeBuild and App Runner use the existing `keystone-aws-dev` private subnets and NAT in `vpc-0e90d6f615820fad0`. They connect to the existing public RDS endpoint with verified TLS. The RDS VPC has no private NAT route, and there is no peering between these VPCs. No shared route or RDS security-group rules were changed.

Reuse these dedicated resources for subsequent changes:

| Resource | Name or identifier |
| --- | --- |
| Migration security group | `sg-084b7ece3c4fb44bb` |
| Runtime security group | `sg-05c008fb6caf14381` |
| App Runner VPC connector | `keystone-sales-tracking-api` |
| App Runner scaling configuration | `keystone-sales-tracking-api` |
| ECR access role | `keystone-sales-tracking-apprunner-access` |
| Runtime instance role | `keystone-sales-tracking-apprunner-instance` |
| Migration service role | `keystone-sales-ops-migration-codebuild` |
| Release service role, reused | `keystone-sales-tracking-image-codebuild` |
| Vercel project | `prj_msn2yEqdhOOzf9bgO3OxXhL5JUR3` |

The reused private subnets are `subnet-00d6f5abaa939690a`, `subnet-046cce7edcf5a4721`, and `subnet-0cdaf5386472408de`. The release role's `iam:PassRole` permission is limited to the two App Runner roles above. Migration status reads are scoped to the migration project ARN, as required by CodeBuild.

With explicit approval for this initial deployment, runtime and migrations use the existing `sales_tracking_system_app` database owner. This gives the API schema-changing privileges. A database administrator should create a separate DML-only runtime login later and update only SSM `database-url`; retain the owner login for `database-migration-url`.

App Runner uses one instance, with minimum and maximum size 1. Its ECR automatic deployments are disabled so image pushes cannot bypass migrations.

IAM user `yashraj@keystonecommerce.in` has the scoped `sales-tracking-migration-operator` inline policy for migration build start/stop/status, log reads and migration-role lookup. It does not grant direct secret reads or project editing.

## Frontend releases

Use Node 22 and the package manager pinned in `package.json`. `pnpm@11.12.0` was rejected by Vercel as a broken release; the project now pins `pnpm@11.28.10` with the same dependency lockfile.

```sh
vercel link --yes --project keystone-sales-tracking-system
vercel deploy --prod --yes
```

Vercel is connected to GitHub and automatically deploys `main` when frontend files or shared frontend build/dependency settings change. `scripts/vercel-ignore-build.sh` compares against the last successful deployment, including all commits in a push. Backend-only and documentation-only changes skip the frontend build. The watched paths are listed in that script; update them when adding a new frontend source/config directory. A missing comparison commit triggers a build rather than risking a missed release. Other branches do not deploy against production data.

Frontend and backend releases run independently. Keep API changes backward compatible during deployments that change both sides.

Git-triggered Vercel deployments require a commit author with access to the Vercel team. This checkout uses the approved `Keystone Commerce <tech@keystonecommerce.in>` identity for deployment commits. Other developers need their own authorized Vercel access before their frontend commits can deploy automatically.

## Backend releases

The existing `keystone-sales-tracking-image` CodeBuild project now uses `backend/ci/buildspec.yml` and runs the complete release sequence. Its name was preserved to avoid a duplicate build project. A signed GitHub push webhook triggers it for `main` only when files under `backend/` change. Build concurrency is limited to one.

1. Install and test the backend.
2. Build and push an immutable ECR release tag.
3. Start `keystone-sales-ops-migrations` with that image tag and its SHA-256 digest.
4. Verify the pulled digest and apply pending migrations through the protected migration parameter.
5. Update App Runner only after the migration succeeds, then verify `/readyz`.

A failed migration stops the release before App Runner is updated. Production API startup does not run migrations or seed data. The release role cannot read database parameters directly and cannot start the separate admin bootstrap job.

To start a release manually, use an explicit reviewed commit:

```sh
aws codebuild start-build --region ap-south-1 \
  --project-name keystone-sales-tracking-image \
  --source-version COMMIT_SHA
```

The AWS GitHub connection could fetch source but could not register the webhook. The webhook was created with CodeBuild's manual-creation flow and registered through the authenticated GitHub CLI. GitHub repository webhook ID: `707232464`.

## Verification and remaining acceptance

TypeScript validation and all 58 backend tests passed. The Vercel production build succeeded. The backend returns HTTP 200 with `status: ready`; the frontend returns HTTP 200, and its `/api/auth/me` rewrite returns the expected HTTP 401 without a session. The Gmail OAuth token refresh succeeded with `gmail.send` scope. All 17 migration ledger entries and the active initial admin were verified in RDS.

The Git-triggered Vercel deployment of commit `fdbe6b72acc6e4fa0f46774d7838bc35e153186c` succeeded. The frontend filter was exercised against backend-only, documentation-only, multi-commit frontend, shared-dependency, first-deployment and missing-history cases.

Real OTP delivery, an interactive login, authenticated document uploads/downloads and a database restore drill still require acceptance testing. No OTP email was sent during infrastructure setup. This deployment does not claim those checks have passed.
