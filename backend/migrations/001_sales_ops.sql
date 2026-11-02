CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','sales','logistics','finance','viewer')),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE, email text NOT NULL DEFAULT '', gstin text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT '', terms integer NOT NULL DEFAULT 30 CHECK(terms BETWEEN 0 AND 365), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY, code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 customer_id uuid NOT NULL REFERENCES customers(id), description text NOT NULL, sku text NOT NULL DEFAULT '',
 qty integer NOT NULL CHECK(qty>0), rate_paise bigint NOT NULL CHECK(rate_paise>0), gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000),
 stage text NOT NULL CHECK(stage IN ('Draft','Confirmed','On hold','Cancelled')),
 po_ref text NOT NULL DEFAULT '', owner text NOT NULL, target_date date NOT NULL, ship_to text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sourcing_links (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) UNIQUE, external_ref text NOT NULL,
 status text NOT NULL CHECK(status IN ('Requested','In progress','Ready','Blocked')), supplier text NOT NULL DEFAULT '',
 eta date, notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispatches (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), qty integer NOT NULL CHECK(qty>0),
 delivered_qty integer NOT NULL DEFAULT 0 CHECK(delivered_qty>=0), returned_qty integer NOT NULL DEFAULT 0 CHECK(returned_qty>=0),
 carrier text NOT NULL, tracking text NOT NULL, dispatch_date date NOT NULL, expected_date date NOT NULL,
 actual_date date, pod text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('In transit','Partially delivered','Delivered','Returned')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), CHECK(delivered_qty+returned_qty<=qty)
);
CREATE TABLE IF NOT EXISTS invoices (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), number text NOT NULL UNIQUE,
 qty integer NOT NULL CHECK(qty>0), rate_paise bigint NOT NULL CHECK(rate_paise>0), gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000),
 total_paise bigint NOT NULL CHECK(total_paise>0), invoice_date date NOT NULL, due_date date NOT NULL CHECK(due_date>=invoice_date),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS receipts (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), amount_paise bigint NOT NULL CHECK(amount_paise>0),
 reference text NOT NULL, mode text NOT NULL, receipt_date date NOT NULL, recorded_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS receipt_reference_unique ON receipts(invoice_id, lower(reference));
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), title text NOT NULL, owner text NOT NULL, due_date date NOT NULL,
 priority text NOT NULL CHECK(priority IN ('Normal','High','Critical')), status text NOT NULL CHECK(status IN ('Open','In progress','Blocked','Completed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
 entity text NOT NULL, record_id uuid NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatches_order_idx ON dispatches(order_id);
CREATE INDEX IF NOT EXISTS invoices_order_idx ON invoices(order_id);
CREATE INDEX IF NOT EXISTS receipts_invoice_idx ON receipts(invoice_id);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit(created_at DESC);
