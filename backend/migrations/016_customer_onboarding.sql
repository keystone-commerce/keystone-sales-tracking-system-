ALTER TABLE customers
 ADD COLUMN city text NOT NULL DEFAULT '',
 ADD COLUMN state text NOT NULL DEFAULT '',
 ADD COLUMN pin_code text NOT NULL DEFAULT '',
 ADD COLUMN customer_notes text NOT NULL DEFAULT '';
