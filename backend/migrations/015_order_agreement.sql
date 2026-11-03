ALTER TABLE orders
 ADD COLUMN agreement_status text NOT NULL DEFAULT '' CHECK (agreement_status IN ('','Not required','Required - pending','Under review','Signed')),
 ADD COLUMN confirmed_by text NOT NULL DEFAULT '';
