INSERT INTO access_user_roles (user_id, role_id)
SELECT assignment.user_id, member.id
FROM access_user_roles assignment
JOIN access_roles old_role ON old_role.id = assignment.role_id AND old_role.key = 'sales'
CROSS JOIN access_roles member
WHERE member.key = 'member'
ON CONFLICT DO NOTHING;

INSERT INTO access_team_roles (team_id, role_id)
SELECT assignment.team_id, member.id
FROM access_team_roles assignment
JOIN access_roles old_role ON old_role.id = assignment.role_id AND old_role.key = 'sales'
CROSS JOIN access_roles member
WHERE member.key = 'member'
ON CONFLICT DO NOTHING;

DELETE FROM access_user_roles
WHERE role_id IN (SELECT id FROM access_roles WHERE is_system AND key IN ('sales', 'logistics', 'finance'));

DELETE FROM access_team_roles
WHERE role_id IN (SELECT id FROM access_roles WHERE is_system AND key IN ('sales', 'logistics', 'finance'));

DELETE FROM access_role_permissions
WHERE role_id IN (SELECT id FROM access_roles WHERE is_system AND key IN ('sales', 'logistics', 'finance'));

DELETE FROM access_roles
WHERE is_system AND key IN ('sales', 'logistics', 'finance');
