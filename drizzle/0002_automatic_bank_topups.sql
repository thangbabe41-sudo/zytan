ALTER TABLE bank_transfer_settings ADD COLUMN sepay_secret TEXT;
--> statement-breakpoint
ALTER TABLE bank_transfer_settings ADD COLUMN verified_at INTEGER;
--> statement-breakpoint
CREATE TABLE bank_topups (
  reference TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 499999999),
  bin TEXT NOT NULL,
  account TEXT NOT NULL,
  holder TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  transaction_id TEXT UNIQUE,
  paid_at INTEGER,
  code_hash TEXT UNIQUE,
  code_cipher TEXT,
  redeemed_by TEXT,
  redeemed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX bank_topups_owner ON bank_topups(owner_hash, created_at DESC);
--> statement-breakpoint
CREATE INDEX bank_topups_redeemed_by ON bank_topups(redeemed_by);
