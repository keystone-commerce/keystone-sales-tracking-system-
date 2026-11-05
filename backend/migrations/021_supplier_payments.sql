
INSERT INTO access_permissions(key,label,group_name,read_only) VALUES
 ('procurement.read','View supplier purchasing','Supplier purchasing',true),
 ('procurement.create','Create suppliers, quotations, POs and requests','Supplier purchasing',false),
 ('procurement.approve','Approve assigned payment requests','Supplier purchasing',false),
 ('procurement.pay','Record supplier payments','Supplier purchasing',false),
 ('procurement.manage','Configure approval policy','Supplier purchasing',false);
INSERT INTO access_role_permissions(role_id,permission)
 SELECT r.id,p.key FROM access_roles r CROSS JOIN access_permissions p
 WHERE r.key='admin' AND p.key LIKE 'procurement.%';
INSERT INTO access_role_permissions(role_id,permission)
 SELECT r.id,p.key FROM access_roles r CROSS JOIN access_permissions p
 WHERE r.key='member' AND p.key IN ('procurement.read','procurement.create');
CREATE TABLE suppliers (
 id uuid PRIMARY KEY, name text NOT NULL, gstin text NOT NULL DEFAULT '',
 contact_name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT '', bank_name text NOT NULL DEFAULT '', account_number text NOT NULL DEFAULT '',
 ifsc text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_name_unique ON suppliers(lower(name));
CREATE TABLE supplier_quotes (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id),
 order_item_id uuid NOT NULL REFERENCES order_items(id), supplier_id uuid NOT NULL REFERENCES suppliers(id),
 reference text NOT NULL, qty integer NOT NULL CHECK(qty>0),
 rate_paise bigint NOT NULL CHECK(rate_paise>0), gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000),
 quote_date date NOT NULL, notes text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(supplier_id,reference,order_item_id)
);
CREATE INDEX supplier_quotes_item_idx ON supplier_quotes(order_item_id);
CREATE TABLE purchase_orders (
 id uuid PRIMARY KEY, quote_id uuid NOT NULL REFERENCES supplier_quotes(id),
 order_id uuid NOT NULL REFERENCES orders(id), order_item_id uuid NOT NULL REFERENCES order_items(id),
 supplier_id uuid NOT NULL REFERENCES suppliers(id), reference text NOT NULL UNIQUE,
 qty integer NOT NULL CHECK(qty>0), rate_paise bigint NOT NULL CHECK(rate_paise>0),
 gst_bps integer NOT NULL CHECK(gst_bps BETWEEN 0 AND 10000), total_paise bigint NOT NULL CHECK(total_paise>0),
 order_date date NOT NULL, expected_date date NOT NULL CHECK(expected_date>=order_date),
 selection_reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_item_idx ON purchase_orders(order_item_id);
CREATE TABLE supplier_approval_policy (
 id integer PRIMARY KEY CHECK(id=1), threshold_paise bigint NOT NULL CHECK(threshold_paise>=0),
 primary_approver uuid REFERENCES users(id), secondary_approver uuid REFERENCES users(id),
 version integer NOT NULL DEFAULT 1,
 CHECK(primary_approver IS DISTINCT FROM secondary_approver OR primary_approver IS NULL)
);
INSERT INTO supplier_approval_policy(id,threshold_paise) VALUES (1,5000000);
CREATE TABLE supplier_payment_requests (
 id uuid PRIMARY KEY, purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
 reference text NOT NULL UNIQUE, amount_paise bigint NOT NULL CHECK(amount_paise>0),
 purpose text NOT NULL, justification text NOT NULL, due_date date NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), primary_approver uuid NOT NULL REFERENCES users(id),
 secondary_approver uuid REFERENCES users(id), approval_step integer NOT NULL DEFAULT 1 CHECK(approval_step IN (1,2)),
 status text NOT NULL DEFAULT 'Pending approval' CHECK(status IN ('Pending approval','Approved','Rejected','Cancelled')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(primary_approver<>created_by),
 CHECK(secondary_approver IS NULL OR (secondary_approver<>created_by AND secondary_approver<>primary_approver))
);
CREATE INDEX supplier_requests_po_idx ON supplier_payment_requests(purchase_order_id);
CREATE TABLE supplier_approvals (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES supplier_payment_requests(id),
 step integer NOT NULL CHECK(step IN (1,2)), actor_id uuid NOT NULL REFERENCES users(id),
 decision text NOT NULL CHECK(decision IN ('Approve','Reject')), remarks text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(request_id,step)
);
CREATE TABLE supplier_payments (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES supplier_payment_requests(id),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), reference text NOT NULL, mode text NOT NULL,
 payment_date date NOT NULL, bank text NOT NULL DEFAULT '', accounting_reference text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplier_payment_reference_unique ON supplier_payments(lower(reference));
CREATE INDEX supplier_payments_request_idx ON supplier_payments(request_id);
CREATE TABLE procurement_documents (
 id uuid PRIMARY KEY, purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
 entity text NOT NULL CHECK(entity IN ('purchase_orders','requests','payments')), record_id uuid NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880),
 content bytea, storage_backend text NOT NULL CHECK(storage_backend IN ('database','s3')),
 storage_bucket text, storage_key text, storage_version text,
 uploaded_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((storage_backend='database' AND content IS NOT NULL) OR
       (storage_backend='s3' AND content IS NULL AND storage_bucket IS NOT NULL AND storage_key IS NOT NULL))
);
CREATE INDEX procurement_documents_record_idx ON procurement_documents(entity,record_id);
