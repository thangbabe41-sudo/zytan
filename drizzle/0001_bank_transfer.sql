CREATE TABLE bank_transfer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bank_bin TEXT NOT NULL CHECK (length(bank_bin) = 6),
  account_number TEXT NOT NULL CHECK (length(account_number) BETWEEN 1 AND 19),
  account_holder TEXT NOT NULL CHECK (length(account_holder) BETWEEN 2 AND 80),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
