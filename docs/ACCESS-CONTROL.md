# Sales Ops access control

Implemented locally using the existing working files in `keystone-main-backend` and `keystone-admin-panel` as read-only references. Those reference projects were not edited, checked out, committed, deployed or pushed.

Reference patterns examined: backend `admin-access.service.ts`, `admin-access-management.service.ts`, `admin-permission.guard.ts`, controller/DTO/schema and permission definitions; frontend `auth-context.tsx`, `admin-access.tsx`, `lib/admin-access.ts` and permission-route/navigation behavior.

## Adaptation

Sales Ops keeps Express, PostgreSQL and cookie sessions. Its own permission registry covers customers, orders, sourcing, dispatches, invoices, receipts, follow-ups, activity and access administration. Existing account roles are migrated to database bindings; existing administrators retain platform access. Multi-role bindings, direct grants and team grants are combined on each request. Clearing all assignments denies access, including for an account whose legacy role name used to grant rights.

Sales Ops has one company workspace, so this implementation intentionally has no partner picker or bindings to the reference applications' tenant IDs. It does not copy authentication secrets, contact their databases, import their users, or add OTP/passkey/SSO behavior.

## Backend modules

- `access/permissions.js`: known keys, system role definitions and guard helper.
- `access/resolver.js`: effective union of direct roles, direct permissions, team roles and team permissions; platform administrator bypass for known keys.
- `access/management.js`: transactional account/role/team management, permission validation, grant limits, immutable system roles, version checks, protected platform administrators, self-lockout protection and access audit entries.
- `access/routes.js`: protected access endpoints.
- Migration `003_configurable_access.sql`: permission catalog, system role seeds, binding/grant tables, team membership and existing user migration. It runs once and does not reset custom roles or team configuration at startup.

Authentication verifies a live session, active account and current database permissions. Mutation routes enforce the entity's action and read permission; creation also checks required parent registers. Standalone register queries are skipped and their datasets are excluded from the workspace response when read access is absent. Invoice allocation summaries are excluded without invoice read access. Order execution status is provided independently as order context, without exposing sourcing references. CSV export uses a separately authorized endpoint; read permission does not automatically grant the export action.

`GET /api/auth/me` and `GET /api/access/session` expose identity and effective access, without password hashes or internal session IDs. Access administration uses `GET /api/access`, `POST /api/access/{users,roles,teams}` and `PUT /api/access/{users,roles,teams}/:id`. The API rejects unknown permission keys and unsupported identity fields such as `is_super_admin` in user-management payloads.

## Frontend behavior

Admin Access has Users, Roles and Teams tabs, search, grouped permission checkboxes, inherited permission indicators and compact dialogs. Role/system identity and active status are shown independently. User and team assignment editors use backend version checks. Creating a user requires an initial password; changing passwords is outside this feature.

Navigation and page guards are independent. Dashboards and linked actions render only permitted datasets. Forms and export actions check action permissions, not role labels. Query cache keys include user identity and effective permissions. Access changes close open record dialogs and change the query scope. The permission session refreshes every 15 seconds and on focus; API authorization is live on every request.

Users can always open the safe overview and their appearance settings, even with no operational permissions.

## Verification

- 21 backend tests passed, including the existing order/multi-SKU flows and the new access tests.
- New tests cover omitted financial datasets and summaries, direct grants plus roles, team inheritance/revocation, empty-access behavior, blocked escalation, protected system/platform access, stale concurrent edits, deactivation, session payloads, audit and export/action prerequisites.
- `scripts/access-browser.mjs` passed: role/user/team creation, restricted menus/actions/data, hidden financial sections, grants revoked in an existing session, account deactivation and a 390px editor layout.
- `scripts/multi-sku-browser.mjs` passed with RBAC enabled.
- Original operational rows, user credential fields and audit entries were compared against the local pre-migration snapshot and preserved. Browser-created test records/accounts/roles/teams were removed afterward.

No cloud deployment or GitHub push was performed. Database/network/hosting production acceptance remains separate from these local checks.
