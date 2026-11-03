ALTER TABLE order_items ADD COLUMN unit_of_measure text NOT NULL DEFAULT 'Nos' CHECK (unit_of_measure IN ('Nos','Pcs','Pairs','Sets','Boxes','Kits','Kg','Meters','Litres','Other'));
