INSERT INTO access_roles (id, key, name, is_system)
VALUES (
  '00000000-0000-4000-8000-000000000006',
  'member',
  CASE WHEN EXISTS (SELECT 1 FROM access_roles WHERE name = 'Member')
    THEN 'Sales Operations Member'
    ELSE 'Member'
  END,
  true
);

INSERT INTO access_role_permissions (role_id, permission)
VALUES
  ('00000000-0000-4000-8000-000000000006', 'customers.read'),
  ('00000000-0000-4000-8000-000000000006', 'customers.create'),
  ('00000000-0000-4000-8000-000000000006', 'orders.read'),
  ('00000000-0000-4000-8000-000000000006', 'orders.create'),
  ('00000000-0000-4000-8000-000000000006', 'orders.update'),
  ('00000000-0000-4000-8000-000000000006', 'sourcing.read'),
  ('00000000-0000-4000-8000-000000000006', 'sourcing.create'),
  ('00000000-0000-4000-8000-000000000006', 'sourcing.update'),
  ('00000000-0000-4000-8000-000000000006', 'tasks.read'),
  ('00000000-0000-4000-8000-000000000006', 'tasks.update');
