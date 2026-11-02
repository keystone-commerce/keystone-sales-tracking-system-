ALTER TABLE orders DROP CONSTRAINT orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check CHECK(stage IN ('Draft','Enquiry','Pricing','Quoted','PO received','Ready for sourcing','Confirmed','On hold','Cancelled'));
ALTER TABLE orders ADD COLUMN request_channel text NOT NULL DEFAULT 'Not recorded' CHECK(request_channel IN ('Not recorded','Call','WhatsApp','Email','In person','Other'));
ALTER TABLE orders ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE orders ADD COLUMN request_notes text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN po_channel text NOT NULL DEFAULT '' CHECK(po_channel IN ('','WhatsApp','Email','In person','Other'));
ALTER TABLE orders ADD COLUMN po_received_date date;
CREATE TABLE order_documents (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id),category text NOT NULL CHECK(category IN ('request','quotation','po')),
 channel text NOT NULL CHECK(channel IN ('Call','WhatsApp','Email','In person','Other')),
 filename text NOT NULL,mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp','application/pdf')),
 content bytea NOT NULL CHECK(octet_length(content)>0 AND octet_length(content)<=5242880),
 uploaded_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 quote_revision integer CHECK(quote_revision IS NULL OR quote_revision>0)
);
CREATE INDEX order_documents_order_idx ON order_documents(order_id,created_at);
