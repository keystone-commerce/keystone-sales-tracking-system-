INSERT INTO access_permissions (key, label, group_name, read_only)
VALUES ('audit.operations.read', 'View sales activity', 'Activity', true);

INSERT INTO access_role_permissions (role_id, permission)
SELECT id, permission
FROM access_roles
CROSS JOIN (VALUES ('customers.export'), ('orders.export'), ('sourcing.export'), ('audit.operations.read')) AS grants(permission)
WHERE key = 'member';
