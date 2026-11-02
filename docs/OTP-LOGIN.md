# Email OTP login

Sales Ops uses the admin panel's email-code approach: enter a registered email, send a six-digit code using Gmail OAuth, verify it, then issue the existing HTTP-only cookie session with live Sales Ops user/role/team permissions. Reference projects were read only; no credentials, user records or sessions were copied. Gmail integration uses native server-side fetch like the reference backend, so no extra mail package is required.

## Current local test

The local backend .env has AUTH_MODE=otp, a generated independent OTP_HMAC_SECRET and local-only OTP_LOG_ONLY=true / OTP_DEV_FIXED_CODE=000000. Existing values were preserved when adding missing settings. Sign in at http://localhost:3210 with admin@keystone.local and code 000000. No email is sent in this mode. The normal send/verify routes, expiry, single-use consumption, resend limits and permissions still run. Local code logging is permitted only with the embedded development database and is blocked in production. No automatic login bypass was added.

## Real email test

1. While local test mode is enabled, sign in and add your real work email through Admin access → New user. Assign the appropriate role/team. New OTP accounts do not need an initial password. Only active, pre-created users can sign in; unknown emails are not registered automatically.
2. Edit backend/.env on your computer and set the Gmail OAuth values below. Do not put credentials in chat or frontend environment variables.
3. Change OTP_LOG_ONLY=false and clear OTP_DEV_FIXED_CODE (leave it empty or remove it). Keep AUTH_MODE=otp and the generated OTP_HMAC_SECRET unchanged.
4. Restart the backend. Enter the registered real email, choose Send code, then enter the received code. Try a wrong code, resend after the cooldown and sign out/sign back in. Real delivery must be tested before deployment.

```text
AUTH_MODE=otp
OTP_HMAC_SECRET=<independent secret of at least 32 bytes>
OTP_LOG_ONLY=false
OTP_DEV_FIXED_CODE=
GMAIL_OAUTH_CLIENT_ID=<OAuth client ID>
GMAIL_OAUTH_CLIENT_SECRET=<OAuth client secret>
GMAIL_OAUTH_REFRESH_TOKEN=<refresh token with gmail.send permission>
GMAIL_SENDER_EMAIL=<authorized sender address>
GMAIL_SENDER_NAME=Keystone Sales Ops
```

Use an authorized sender and a refresh token issued for this OAuth client with Gmail API send access. If generating a new OTP secret, use Node crypto.randomBytes(32).toString('hex') and save its value locally without sharing it. Existing issued codes are invalidated if the secret changes.

## AWS deployment

Set AUTH_MODE=otp, OTP_LOG_ONLY=false and leave OTP_DEV_FIXED_CODE unset. Production startup rejects password mode, local shortcuts, missing Gmail settings, placeholder/short OTP secrets and reuse of JWT_SECRET as the OTP secret. Store OTP_HMAC_SECRET, GMAIL_OAUTH_CLIENT_SECRET and GMAIL_OAUTH_REFRESH_TOKEN in Secrets Manager/SSM and reference them in App Runner. Configure the client ID and sender address/name on the backend as well. Vercel receives only its existing BACKEND_ORIGIN; no Gmail or OTP secrets belong there.

Apply migration 009_email_otp before releasing this backend. The migration CodeBuild job still needs only its database secret, not Gmail credentials. Ensure the runtime database user has DML grants/default privileges on the new OTP tables. App Runner's VPC egress must reach oauth2.googleapis.com and gmail.googleapis.com through appropriate internet/NAT connectivity; an S3 endpoint alone does not provide that connectivity.

## Behaviour

- Codes expire after 5 minutes, can be used once and lock after 3 verification attempts.
- Resend cooldown: 60 seconds. Send quota: 3/email and 20/IP per 15 minutes. Verification quotas: 15/email and 60/IP per 15 minutes. Limits and code state are in PostgreSQL, shared across backend instances.
- Code hashes use HMAC-SHA256 bound to this app, email and challenge ID. Plain codes are not stored in SQL or returned in API responses. Session creation and OTP consumption commit in the same transaction. A disabled account cannot consume a code into a session.
- Resending invalidates preceding challenges. Unknown/disabled accounts receive the same send response without an email. Delivery failures invalidate the challenge, log only a sanitized event and retain a generic send result to avoid revealing registered emails. Check the backend's otp_email_delivery_failed event if mail does not arrive.
- Expired OTP/rate-limit data older than one day is cleaned up during sends. Successful sign-ins are audited without codes or credentials.
- POST /api/auth/login is disabled in OTP mode. AUTH_MODE=password remains a local-only compatibility option for existing internal test fixtures; it is rejected in production.

Sources: local keystone-admin-panel login and keystone-main-backend auth/email modules; Google Gmail send and OAuth refresh documentation: https://developers.google.com/workspace/gmail/api/guides/sending and https://developers.google.com/identity/protocols/oauth2/web-server .
