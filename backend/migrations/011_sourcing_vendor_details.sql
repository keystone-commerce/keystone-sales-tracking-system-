ALTER TABLE sourcing_links
  ADD COLUMN vendor_gstin text NOT NULL DEFAULT '',
  ADD COLUMN vendor_phone text NOT NULL DEFAULT '',
  ADD COLUMN vendor_email text NOT NULL DEFAULT '';
