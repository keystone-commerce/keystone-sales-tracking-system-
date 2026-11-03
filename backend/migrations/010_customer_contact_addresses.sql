ALTER TABLE customers ADD COLUMN contact_name text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN billing_address text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN shipping_address text NOT NULL DEFAULT '';
UPDATE customers SET billing_address=address, shipping_address=address WHERE address<>'';
