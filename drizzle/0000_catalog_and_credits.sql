CREATE TABLE catalog_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  price INTEGER NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 100000),
  photo TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE xu_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  suffix TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 10000000),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  wallet_id TEXT,
  redeemed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX xu_codes_wallet ON xu_codes(wallet_id);
