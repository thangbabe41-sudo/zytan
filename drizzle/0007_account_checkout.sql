CREATE TABLE account_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_accounts(id),
  fingerprint TEXT NOT NULL UNIQUE,
  credential_cipher TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX account_stock_product ON account_stock(product_id, created_at);
--> statement-breakpoint
CREATE TABLE account_orders (
  member_id TEXT NOT NULL REFERENCES members(id),
  id TEXT NOT NULL,
  stock_id TEXT NOT NULL UNIQUE REFERENCES account_stock(id),
  wallet_hash TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, id)
);
--> statement-breakpoint
CREATE INDEX account_orders_wallet ON account_orders(wallet_hash);
--> statement-breakpoint
CREATE INDEX account_orders_history ON account_orders(member_id, created_at DESC, id DESC);
