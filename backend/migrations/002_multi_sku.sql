CREATE TABLE order_items (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), position integer NOT NULL CHECK(position>0),
 sku text NOT NULL, description text NOT NULL, qty integer NOT NULL CHECK(qty>0),
 rate_paise bigint NOT NULL CHECK(rate_paise>0), gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000),
 UNIQUE(order_id,position), UNIQUE(order_id,id)
);
INSERT INTO order_items(id,order_id,position,sku,description,qty,rate_paise,gst_bps)
 SELECT id,id,1,sku,description,qty,rate_paise,gst_bps FROM orders;
CREATE UNIQUE INDEX order_item_sku_unique ON order_items(order_id,lower(sku)) WHERE sku<>'';
ALTER TABLE dispatches ADD CONSTRAINT dispatch_order_pair UNIQUE(id,order_id);
CREATE TABLE dispatch_items (
 id uuid PRIMARY KEY, dispatch_id uuid NOT NULL, order_id uuid NOT NULL, order_item_id uuid NOT NULL,
 qty integer NOT NULL CHECK(qty>0), delivered_qty integer NOT NULL DEFAULT 0 CHECK(delivered_qty>=0),
 returned_qty integer NOT NULL DEFAULT 0 CHECK(returned_qty>=0), CHECK(delivered_qty+returned_qty<=qty),
 FOREIGN KEY(dispatch_id,order_id) REFERENCES dispatches(id,order_id),
 FOREIGN KEY(order_id,order_item_id) REFERENCES order_items(order_id,id), UNIQUE(dispatch_id,order_item_id)
);
INSERT INTO dispatch_items(id,dispatch_id,order_id,order_item_id,qty,delivered_qty,returned_qty)
 SELECT id,id,order_id,order_id,qty,delivered_qty,returned_qty FROM dispatches;
ALTER TABLE invoices ADD CONSTRAINT invoice_order_pair UNIQUE(id,order_id);
CREATE TABLE invoice_items (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL, order_id uuid NOT NULL, order_item_id uuid NOT NULL,
 qty integer NOT NULL CHECK(qty>0), rate_paise bigint NOT NULL CHECK(rate_paise>0),
 gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000), total_paise bigint NOT NULL CHECK(total_paise>0),
 FOREIGN KEY(invoice_id,order_id) REFERENCES invoices(id,order_id),
 FOREIGN KEY(order_id,order_item_id) REFERENCES order_items(order_id,id), UNIQUE(invoice_id,order_item_id)
);
INSERT INTO invoice_items(id,invoice_id,order_id,order_item_id,qty,rate_paise,gst_bps,total_paise)
 SELECT id,id,order_id,order_id,qty,rate_paise,gst_bps,total_paise FROM invoices;
ALTER TABLE sourcing_links ADD COLUMN order_item_id uuid;
UPDATE sourcing_links SET order_item_id=order_id;
ALTER TABLE sourcing_links ALTER COLUMN order_item_id SET NOT NULL;
ALTER TABLE sourcing_links ADD CONSTRAINT sourcing_order_item_fk FOREIGN KEY(order_id,order_item_id) REFERENCES order_items(order_id,id);
ALTER TABLE sourcing_links DROP CONSTRAINT sourcing_links_order_id_key;
ALTER TABLE sourcing_links ADD CONSTRAINT sourcing_item_unique UNIQUE(order_item_id);
CREATE INDEX dispatch_items_order_item_idx ON dispatch_items(order_item_id);
CREATE INDEX invoice_items_order_item_idx ON invoice_items(order_item_id);
