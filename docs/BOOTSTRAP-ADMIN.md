# One-time production administrator setup

Prepared locally only. No AWS resources have been created, no production database was changed, and no image/source was pushed.

The approved first administrator is **yashraj@keystonecommerce.in**, name **Yashraj**, role **admin** (full administrator access, matching the existing admin model). These are application user settings, separate from AWS IAM permissions.

## Files

- backend/ci/bootstrap-admin-project.example.json: a dedicated, manually started NO_SOURCE CodeBuild project, with the inline buildspec embedded and your email/name/role populated.
- backend/ci/bootstrap-admin-buildspec.yml: the readable version of that same buildspec. Keep the embedded JSON version in sync if editing.
- backend/ci/bootstrap-admin-start.example.json: manual start request; fill in the immutable release tag and full SHA256 digest from the release record.
- backend/src/bootstrap-admin.js: transactionally creates the first admin with an unknown random password hash, admin role assignment and audit entry. Sign-in uses OTP.
- backend/src/manage.js: command entry point, node src/manage.js bootstrap-admin-once.

## Flow

Release image in ECR → migrations finish in RDS → manually start bootstrap job → pull and verify that exact release image → run bootstrap-admin-once against RDS → create the first admin → sign in through Vercel/App Runner using Gmail OTP → add teammates in Admin access.

This job does not run migrations, start/update App Runner, push an image, send an OTP, or change the frontend. It is not called by the normal deployment or migration jobs. DEPLOY_MODE=bootstrap in the existing release pipeline means initial image/database preparation; it is a different operation from creating an application admin.

## AWS values to fill later

The project is prefilled for account 415407325762 and region ap-south-1, repository keystone-sales-tracking-api. Confirm these before use. Replace YOUR_VPC_ID, YOUR_PRIVATE_SUBNET_ID and YOUR_BOOTSTRAP_SECURITY_GROUP_ID in the project JSON. Create/configure the referenced CodeBuild service role separately; the JSON does not provision IAM or networking.

Use the same private RDS network as migrations. Allow outbound PostgreSQL 5432 from the bootstrap security group to the Sales Ops database. Provide connectivity for ECR API/Docker pulls, S3 image layers, SSM/KMS secret reads and CloudWatch Logs through appropriate private endpoints or egress. Docker privileged mode is required for this VPC CodeBuild container job.

Create the SecureString parameter /keystone/sales-ops/production/database-bootstrap-url with the production PostgreSQL connection string. CodeBuild maps DATABASE_URL from this parameter. Use a dedicated short-lived bootstrap database identity with CONNECT, schema USAGE, SELECT/INSERT on users and access_user_roles, SELECT on access_roles, and INSERT on audit. No schema-changing rights are required. SELECT on audit can be granted for operational verification. The image contains the public RDS CA; the job enforces verified TLS using DATABASE_CA_FILE=/app/certs/rds-ca.pem. No database password belongs in the JSON or source package.

The CodeBuild IAM role needs scoped ECR pull permissions, ECR authorization-token access, SSM read for that exact parameter, KMS decrypt if applicable, CloudWatch Logs, and the VPC network-interface permissions required by CodeBuild. It does not need App Runner, ECR push, Gmail, document-bucket access or migration credentials. Only approved operators should be allowed to start or modify this job or override its buildspec/environment; it grants application admin access. The ordinary deployment role should not start it.

Run migrations before this task. Build/publish a NEW backend image that includes bootstrap-admin.js and the bootstrap-admin-once command; an older image will not have this command.

## Manual commands for later — do not run during preparation

After IAM/networking/secret values are configured and the files reviewed, create the CodeBuild project from the project root:

~~~powershell
aws codebuild create-project --region ap-south-1 --cli-input-json file://backend/ci/bootstrap-admin-project.example.json
~~~

Fill in the release tag and digest in backend/ci/bootstrap-admin-start.example.json, then start it once:

~~~powershell
aws codebuild start-build --region ap-south-1 --cli-input-json file://backend/ci/bootstrap-admin-start.example.json
~~~

Alternatively, choose Start build on keystone-sales-ops-bootstrap-admin in the AWS console and supply RELEASE_IMAGE and EXPECTED_IMAGE_DIGEST. The email/name/role are already project environment variables. Wait for SUCCEEDED and the log message Initial admin created. Then open the deployed frontend, request an OTP for yashraj@keystonecommerce.in and sign in. Gmail OAuth settings belong to the App Runner backend, not this setup job.

A successful rerun for the same active, fully assigned admin prints Initial admin already exists; no changes made. It preserves the user, password hash, assignments and audit history. The command refuses to promote/reactivate an existing different account or create a new initial admin when another administrator exists. Use Admin access for future user administration.

After successful initial setup, revoke the temporary database identity/secret access and restrict or remove the setup project. Keep migrations and normal deployments separate; they preserve the saved administrator.

## Local verification

Backend tests exercise creation, effective admin permissions, audit insertion, unchanged reruns, concurrent calls, refusal to promote/reactivate existing users, refusal when another admin exists, and transaction rollback. They use in-memory test databases and never connect to your local running database or RDS. The production CLI explicitly rejects the embedded local database. Actual IAM, VPC, RDS TLS and ECR execution remain deployment-time checks.

AWS references: [buildspec and environment variables](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html), [VPC connectivity](https://docs.aws.amazon.com/codebuild/latest/userguide/vpc-support.html).
