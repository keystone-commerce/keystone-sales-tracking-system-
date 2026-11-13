CREATE TABLE sample_rounds (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL,
 order_item_id uuid NOT NULL,
 round_number integer NOT NULL,
 qty integer NOT NULL CHECK (qty > 0),
 sample_type text NOT NULL,
 specifications text NOT NULL,
 needed_on date NOT NULL,
 status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Ordered','Received','QC passed','QC failed','Issued','Customer accepted','Changes requested','Rejected','Approved')),
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (order_id,order_item_id) REFERENCES order_items(order_id,id),
 UNIQUE (order_item_id,round_number),
 UNIQUE (id,order_id,order_item_id)
);

CREATE TABLE sample_events (
 id uuid PRIMARY KEY,
 round_id uuid NOT NULL REFERENCES sample_rounds(id),
 action text NOT NULL,
 event_date date NOT NULL,
 qty integer CHECK (qty > 0),
 reference text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sample_events_round ON sample_events(round_id,created_at);

CREATE TABLE sample_documents (
 id uuid PRIMARY KEY,
 round_id uuid NOT NULL REFERENCES sample_rounds(id),
 category text NOT NULL CHECK (category IN ('qc','issue','approval')),
 filename text NOT NULL,
 mime_type text NOT NULL,
 size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 content bytea,
 storage_backend text NOT NULL CHECK (storage_backend IN ('database','s3')),
 storage_bucket text,
 storage_key text,
 storage_version text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((storage_backend='database' AND content IS NOT NULL) OR
        (storage_backend='s3' AND content IS NULL AND storage_bucket IS NOT NULL AND storage_key IS NOT NULL))
);
CREATE INDEX sample_documents_round ON sample_documents(round_id);

ALTER TABLE supplier_quotes ADD COLUMN sample_round_id uuid,
 ADD COLUMN courier_paise bigint NOT NULL DEFAULT 0 CHECK (courier_paise >= 0 AND (sample_round_id IS NOT NULL OR courier_paise=0)),
 ADD FOREIGN KEY (sample_round_id,order_id,order_item_id) REFERENCES sample_rounds(id,order_id,order_item_id),
 DROP CONSTRAINT supplier_quotes_rate_paise_check,
 ADD CHECK (rate_paise > 0 OR (sample_round_id IS NOT NULL AND rate_paise=0));

ALTER TABLE purchase_orders ADD COLUMN sample_round_id uuid,
 ADD FOREIGN KEY (sample_round_id,order_id,order_item_id) REFERENCES sample_rounds(id,order_id,order_item_id),
 DROP CONSTRAINT purchase_orders_rate_paise_check,
 DROP CONSTRAINT purchase_orders_total_paise_check,
 ADD CHECK (rate_paise > 0 OR (sample_round_id IS NOT NULL AND rate_paise=0)),
 ADD CHECK (total_paise > 0 OR (sample_round_id IS NOT NULL AND total_paise=0));
CREATE UNIQUE INDEX one_purchase_per_sample_round ON purchase_orders(sample_round_id) WHERE sample_round_id IS NOT NULL;
