ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_revision integer NOT NULL DEFAULT 1 CHECK(accepted_revision>0);
UPDATE orders SET accepted_revision=CASE WHEN stage IN ('PO received','Ready for sourcing','Confirmed') THEN order_revision ELSE GREATEST(1,order_revision-1) END;
