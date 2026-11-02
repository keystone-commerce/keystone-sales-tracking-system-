ALTER TABLE orders DROP CONSTRAINT orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check CHECK(stage IN ('Draft','Enquiry','Pricing','Quoted','PO received','Ready for sourcing','Confirmed','Awaiting revised PO','On hold','Cancelled'));
ALTER TABLE orders ADD COLUMN order_revision integer NOT NULL DEFAULT 1 CHECK(order_revision>0);
ALTER TABLE orders ADD COLUMN amendment_notes text NOT NULL DEFAULT '';
ALTER TABLE order_documents ADD COLUMN order_revision integer NOT NULL DEFAULT 1 CHECK(order_revision>0);
