ALTER TABLE account_stock ADD COLUMN mail_fingerprint TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX account_stock_mail ON account_stock(mail_fingerprint)
  WHERE mail_fingerprint IS NOT NULL;
