const walletFunds = "(SELECT COALESCE(SUM(amount),0) FROM bank_topups WHERE redeemed_by=?) - " +
  "(SELECT COALESCE(SUM(amount),0) FROM account_orders WHERE wallet_hash=?)";
const unsoldStock = "NOT EXISTS (SELECT 1 FROM account_orders WHERE stock_id=stock.id)";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const memberBankOwner = (memberId) => hashCode("member-bank:" + memberId);
const validProductId = (id) => defaultAccountsById.has(id) || (typeof id === "string" && uuidPattern.test(id));

async function walletBalance(db, owner) {
  const row = await db.prepare("SELECT " + walletFunds + " AS amount").bind(owner, owner).first();
  return row.amount;
}

async function stockCounts(db) {
  const { results } = await db.prepare(
    "SELECT product_id, COUNT(*) AS stock FROM account_stock AS stock WHERE " + unsoldStock + " GROUP BY product_id",
  ).all();
  return new Map(results.map((item) => [item.product_id, item.stock]));
}

async function stockForAdmin(db, productId) {
  if (!validProductId(productId)) return error("Mặt hàng không hợp lệ.", 400);
  const { results } = await db.prepare(
    "SELECT stock.id, stock.created_at, EXISTS (SELECT 1 FROM account_orders WHERE stock_id=stock.id) AS sold " +
    "FROM account_stock AS stock WHERE product_id=? ORDER BY stock.created_at DESC, stock.id DESC LIMIT 100",
  ).bind(productId).all();
  return json({ items: results });
}

async function stockFingerprint(env, login) {
  const root = await crypto.subtle.importKey("raw", hexBytes(env.PAYMENT_STORAGE_KEY), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: textEncoder.encode("ziko-stock-fingerprint:v1") },
    root, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(login.toLowerCase()))));
}

async function addStock(env, data) {
  const { productId } = data;
  const login = typeof data.login === "string" ? data.login.trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const note = typeof data.note === "string" ? data.note.trim() : "";
  if (!validProductId(productId) || !login || login.length > 180 || !password || password.length > 256 ||
      note.length > 400 || /[\r\n\u0000]/.test(login + password)) {
    return error("Kiểm tra mặt hàng, tên đăng nhập, mật khẩu và ghi chú.", 400);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const cipher = await seal(env, JSON.stringify({ login, password, note }), "account-stock:" + id);
  const fingerprint = await stockFingerprint(env, login);
  const db = env.DB;
  const defaults = defaultAccountsById.get(productId);
  const statements = [];
  if (defaults) {
    statements.push(db.prepare(
      "INSERT INTO catalog_accounts (id, name, price, stock, photo, active, updated_at) VALUES " +
      "(?, ?, COALESCE((SELECT json_extract(amounts, '$[0]') FROM catalog_prices WHERE product_id=?), ?), 0, ?, 1, ?) " +
      "ON CONFLICT(id) DO NOTHING",
    ).bind(productId, defaults.name, productId, defaults.price, defaults.photo, now));
  }
  statements.push(db.prepare(
    "INSERT INTO account_stock (id, product_id, fingerprint, credential_cipher, created_at) " +
    "SELECT ?, id, ?, ?, ? FROM catalog_accounts WHERE id=? AND kind='account' " +
    "ON CONFLICT(fingerprint) DO NOTHING RETURNING id",
  ).bind(id, fingerprint, cipher, now, productId));
  const inserted = (await db.batch(statements)).at(-1).results[0];
  if (inserted) return json(inserted, 201);
  const product = await db.prepare("SELECT kind FROM catalog_accounts WHERE id=?").bind(productId).first();
  return product?.kind === "account" ? error("Tên đăng nhập acc này đã có trong kho.", 409) :
    error("Không tìm thấy mặt hàng loại Acc.", 404);
}

async function removeStock(db, id) {
  if (typeof id !== "string" || !uuidPattern.test(id)) return error("Mã kho không hợp lệ.", 400);
  const row = await db.prepare(
    "DELETE FROM account_stock AS stock WHERE id=? AND " + unsoldStock + " RETURNING id",
  ).bind(id).first();
  return row ? json(row) : error("Acc đã bán hoặc không còn trong kho.", 409);
}

async function orderRow(db, memberId, id) {
  return db.prepare(
    "SELECT orders.id, orders.amount, orders.title, orders.created_at, stock.id AS stock_id, stock.product_id, stock.credential_cipher " +
    "FROM account_orders AS orders JOIN account_stock AS stock ON stock.id=orders.stock_id " +
    "WHERE orders.member_id=? AND orders.id=?",
  ).bind(memberId, id).first();
}

async function decodeStock(env, id, cipher) {
  return JSON.parse(await unseal(env, cipher, "account-stock:" + id));
}

async function orderReceipt(env, row, account) {
  const { id, amount, title, created_at } = row;
  account ??= await decodeStock(env, row.stock_id, row.credential_cipher);
  return json({ order: { id, amount, title, created_at, account } });
}

async function purchaseAccount(env, member, data) {
  const { productId, price, requestId } = data;
  if (!validProductId(productId) || !inRange(price, 1, 100000000) ||
      typeof requestId !== "string" || !uuidPattern.test(requestId)) return error("Đơn mua không hợp lệ.", 400);
  if (!storageKeyPattern.test(env.PAYMENT_STORAGE_KEY)) return error("Mua acc đang tạm ngưng.", 503);
  const db = env.DB;
  const owner = await memberBankOwner(member.id);
  let row = await orderRow(db, member.id, requestId);
  let candidate;
  let account;
  if (!row) {
    candidate = await db.prepare(
      "SELECT stock.id, stock.credential_cipher FROM account_stock AS stock JOIN catalog_accounts AS product ON product.id=stock.product_id " +
      "WHERE product.id=? AND product.kind='account' AND product.active=1 AND product.price=? AND " + unsoldStock +
      " ORDER BY stock.created_at, stock.id LIMIT 1",
    ).bind(productId, price).first();
    if (candidate) {
      account = await decodeStock(env, candidate.id, candidate.credential_cipher);
      // One write both assigns stock and records the debit against the current available funds.
      await db.prepare(
        "INSERT INTO account_orders (member_id, id, stock_id, wallet_hash, amount, title, created_at) " +
        "SELECT ?, ?, stock.id, ?, product.price, product.name, ? FROM account_stock AS stock " +
        "JOIN catalog_accounts AS product ON product.id=stock.product_id " +
        "WHERE stock.id=? AND product.id=? AND product.kind='account' AND product.active=1 AND product.price=? AND " + unsoldStock +
        " AND (" + walletFunds + ")>=product.price ON CONFLICT(member_id, id) DO NOTHING",
      ).bind(member.id, requestId, owner, Date.now(), candidate.id, productId, price, owner, owner).run();
    }
    row = await orderRow(db, member.id, requestId);
  }
  if (row) {
    if (row.product_id !== productId || row.amount !== price) return error("Mã yêu cầu đã được dùng cho đơn khác.", 409);
    return orderReceipt(env, row, row.stock_id === candidate?.id ? account : undefined);
  }
  const product = await db.prepare(
    "SELECT product.price, EXISTS (SELECT 1 FROM account_stock AS stock WHERE stock.product_id=product.id AND " + unsoldStock +
    ") AS available FROM catalog_accounts AS product WHERE id=? AND kind='account' AND active=1",
  ).bind(productId).first();
  if (!product?.available) return error("Acc này đã hết hàng.", 409);
  if (product.price !== price) return error("Giá đã đổi. Tải lại danh mục rồi chọn mua lại.", 409);
  if (await walletBalance(db, owner) < price) return error("Số dư Ziko chưa đủ. Nạp thêm tiền rồi thử lại.", 409);
  return error("Chưa hoàn tất đơn. Vui lòng thử lại.", 409);
}

async function listOrders(db, memberId, cursor) {
  const createdAt = cursor.get("at");
  const id = cursor.get("id");
  const hasCursor = createdAt !== null || id !== null;
  if (hasCursor && (!/^\d{1,16}$/.test(createdAt) || !Number.isSafeInteger(Number(createdAt)) || !uuidPattern.test(id))) {
    return error("Trang lịch sử không hợp lệ.", 400);
  }
  const where = hasCursor ? " AND (created_at<? OR (created_at=? AND id<?))" : "";
  const params = hasCursor ? [memberId, Number(createdAt), Number(createdAt), id] : [memberId];
  const { results } = await db.prepare(
    "SELECT id, amount, title, created_at FROM account_orders WHERE member_id=?" + where + " ORDER BY created_at DESC, id DESC LIMIT 21",
  ).bind(...params).all();
  const orders = results.slice(0, 20);
  const last = orders.at(-1);
  return json({ orders, more: results.length > 20 ? { at: last.created_at, id: last.id } : null });
}
