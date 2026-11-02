# Automated migrations and backend deployment

This prepares a Sales Ops-only AWS CodeBuild flow. No AWS jobs/resources were created, no migrations were run against AWS, and no code was pushed. Team Portal was inspected read-only. Its local production setup currently keeps migrations manual in a separate VPC CodeBuild job; this Sales Ops flow automatically runs such a job before release.

## Release sequence

Upload the backend source ZIP → start deployment build → install/test → build/push a uniquely tagged image → run migration job using that exact image/digest → wait for success → update App Runner → verify /readyz.

The first release uses DEPLOY_MODE=bootstrap: build/push and initialize the database, then stop so App Runner can be created against a ready database. After creating the service, set its ARN and switch DEPLOY_MODE=deploy. Frontend deployment remains on Vercel and is separate.

## One-time AWS setup

Create the two project definitions using backend/ci/deploy-project.example.json and migration-project.example.json as reviewable examples. Replace every YOUR_* placeholder first. These files are not a provisioned infrastructure stack.

1. Deployment project: keystone-sales-ops-deploy. Source is a private/versioned S3 object containing the generated ZIP, with buildspec backend/ci/buildspec.yml. Use Linux x86 CodeBuild standard:7.0, Node 22, Docker privileged mode, concurrency limit 1 and timeout 60 minutes. It needs internet access for npm and Docker's base image. It does not need the database secret or direct database access.
2. Migration project: keystone-sales-ops-migrations. NO_SOURCE, using the inline YAML from backend/ci/migration-buildspec.yml. The JSON example embeds that YAML because NO_SOURCE cannot load a relative source buildspec. Use Linux x86 CodeBuild standard:7.0 with Docker privileged mode, a 20-minute timeout and concurrency limit 1. Place it in the RDS VPC with private subnets and a dedicated security group allowed to reach PostgreSQL 5432. Provide private endpoints or egress for ECR image pulls, S3 layers and CloudWatch Logs.
3. Configure DATABASE_URL on the migration project as PARAMETER_STORE or SECRETS_MANAGER, pointing to a dedicated migration/DDL database identity, not the runtime application user. The example uses /keystone/sales-ops/production/database-migration-url. Never put its value in plaintext variables, source ZIPs or logs. The public RDS CA is already in the backend image.
4. Configure EXPECTED_ECR_REPOSITORY_URI on the migration project to the dedicated Sales Ops repository. The parent supplies RELEASE_IMAGE and EXPECTED_IMAGE_DIGEST per build. The migration job checks that the image belongs to this repository and that the pulled digest matches before running node src/manage.js migrate. It does not start the API, seed sample data or create application users.
5. Configure the parent environment: ECR_REPOSITORY_URI, MIGRATION_PROJECT_NAME, DEPLOY_MODE and APP_RUNNER_SERVICE_ARN (required after bootstrap). AWS_DEFAULT_REGION is provided by CodeBuild. Default image tags come from the unique build ID; optional RELEASE_TAG must also be unique. Keep ECR tags immutable.

## Role separation

The deployment CodeBuild role needs source-artifact read, its log permissions, scoped ECR push/describe, codebuild:StartBuild and BatchGetBuilds for the dedicated migration project/builds, and App Runner DescribeService/UpdateService/ListOperations on the exact Sales Ops service. Include scoped iam:PassRole for any existing App Runner access/instance roles required by UpdateService. Do not grant it the migration database secret.

The migration CodeBuild role needs scoped ECR pull, read/decrypt access to the migration secret, CloudWatch Logs and required VPC network-interface permissions. Its database identity owns/changes schema. It does not need App Runner deployment permissions or S3 document access. The App Runner runtime role and runtime database identity remain separate and should not have migration/DDL permissions.

## Local upload workflow without GitHub

Run in the project root:

```powershell
.\scripts\package-ci.ps1
```

This creates work/sales-ops-ci-source.zip using an allowlist of backend source, tests, migrations, certificates, buildspecs and Docker/package files. It excludes .env files, local data, uploads, node_modules and Git history. Upload it to the configured private source bucket/object, then choose Start build on the deployment project. Record the source S3 object version for release traceability.

To run automatically whenever that source ZIP changes, configure CodePipeline with that versioned S3 object as Source and the deployment CodeBuild project as Build. Set project source/artifacts to CODEPIPELINE for that integration and use queued execution to serialize releases. This is an AWS setup step; uploading an image to ECR alone does not run database migrations. GitHub can be connected later if authorized; it is not required for the source-ZIP flow.

## Future database changes

Add a new file under backend/migrations, e.g. 009_add_customer_contact.sql, then include it in the next release. Filenames must be NNN_name.sql with unique sequence numbers. The runner discovers and sorts SQL automatically, skips names in schema_migrations and holds a PostgreSQL advisory lock. Pending migrations and their ledger writes run transactionally; a failure rolls back the pending batch and prevents the App Runner update. Entire SQL files are executed so function bodies and quoted semicolons work. Logs report applied/skipped migrations without printing credentials.

Never edit/rename an already-applied migration to change production schema: add a new migration. Review SQL for backwards compatibility because the previous API remains live while migrations run. Use additive/expand-contract changes. Destructive/data-rewriting migrations need a separate reviewed release/backup procedure. Readiness or deployment failure marks the build failed and records the preceding image reference, but does not automatically reverse database changes or issue another deployment.

Application administrator bootstrap remains a one-time protected task, not part of each release. This pipeline does not configure RDS/S3/roles/secrets or deploy the frontend. Those must be prepared separately. Real Docker/ECR pulls, VPC RDS connectivity, IAM, concurrent release handling and deployed readiness remain AWS acceptance checks.


## First application administrator

Use the separate manual task in [BOOTSTRAP-ADMIN.md](BOOTSTRAP-ADMIN.md) after successful migrations. The prepared project is keystone-sales-ops-bootstrap-admin and the approved first admin is yashraj@keystonecommerce.in. Normal releases do not call this task. DEPLOY_MODE=bootstrap prepares the initial release/database; it does not create an application administrator.
