ALTER TABLE catalog_accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'account'
  CHECK (kind IN ('account', 'other'));
