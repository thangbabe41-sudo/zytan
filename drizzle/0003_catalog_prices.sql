CREATE TABLE catalog_prices (
  product_id TEXT PRIMARY KEY,
  amounts TEXT NOT NULL CHECK (json_valid(amounts))
);
