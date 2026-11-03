ALTER TABLE sourcing_links DROP CONSTRAINT sourcing_links_status_check;
ALTER TABLE sourcing_links ADD CONSTRAINT sourcing_links_status_check
 CHECK (status IN ('Requested', 'In progress', 'Ready', 'Blocked', 'Rejected'));
