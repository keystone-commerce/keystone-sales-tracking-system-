ALTER TABLE sourcing_links ADD COLUMN supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE sourcing_links DROP CONSTRAINT sourcing_item_unique;
CREATE UNIQUE INDEX sourcing_supplier_unique ON sourcing_links(order_item_id,supplier_id) WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX sourcing_legacy_item_unique ON sourcing_links(order_item_id) WHERE supplier_id IS NULL;
ALTER TABLE sourcing_links ADD CONSTRAINT sourcing_supplier_identity UNIQUE(id,order_id,order_item_id,supplier_id);
ALTER TABLE supplier_quotes ADD COLUMN sourcing_link_id uuid;
ALTER TABLE supplier_quotes ADD CONSTRAINT quote_sourcing_supplier_fk
 FOREIGN KEY(sourcing_link_id,order_id,order_item_id,supplier_id)
 REFERENCES sourcing_links(id,order_id,order_item_id,supplier_id);
CREATE INDEX supplier_quotes_sourcing_idx ON supplier_quotes(sourcing_link_id);
