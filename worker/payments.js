const maxTopup = 499999999;
const topupLifetime = 86400000;
const referencePattern = /^ZIKO[A-F0-9]{12}$/;
const transferCodePattern = /^ZK-[A-F0-9]{32}$/;
const storageKeyPattern = /^[a-f0-9]{64}$/;
const textEncoder = new TextEncoder();

function hexBytes(value) {
  return Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
}

async function storageKey(env, operation) {
  if (!storageKeyPattern.test(env.PAYMENT_STORAGE_KEY)) throw new Error("Missing payment storage key");
  return crypto.subtle.importKey("raw", hexBytes(env.PAYMENT_STORAGE_KEY), "AES-GCM", false, [operation]);
}

async function seal(env, plain, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: textEncoder.encode(purpose) },
    await storageKey(env, "encrypt"), textEncoder.encode(plain)
  ));
  return btoa(String.fromCharCode(...iv, ...bytes));
}

async function unseal(env, cipher, purpose) {
  const bytes = Uint8Array.from(atob(cipher), (value) => value.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: textEncoder.encode(purpose) },
    await storageKey(env, "decrypt"), bytes.subarray(12)
  );
  return new TextDecoder().decode(plain);
}

async function getBankSettings(db) {
  return db.prepare("SELECT bank_bin AS bin, account_number AS account, account_holder AS holder, enabled, sepay_secret, verified_at FROM bank_transfer_settings WHERE id=1").first();
}

function receiver(settings) {
  return { bin: settings.bin, bank: BANKS[settings.bin], account: settings.account, holder: settings.holder };
}

function paymentReady(env, settings) {
  return Boolean(settings?.enabled && settings?.sepay_secret && settings?.verified_at && storageKeyPattern.test(env.PAYMENT_STORAGE_KEY));
}

async function bankSettingsForOwner(db) {
  const settings = await getBankSettings(db);
  return settings ? {
    ...receiver(settings), enabled: Boolean(settings.enabled), hasSecret: Boolean(settings.sepay_secret), verifiedAt: settings.verified_at,
  } : null;
}

async function saveBankSettings(env, data) {
  const { bin, enabled } = data;
  const account = typeof data.account === "string" ? data.account.trim() : "";
  const holder = typeof data.holder === "string" ? data.holder.trim() : "";
  const secret = typeof data.secret === "string" ? data.secret.trim() : "";
  if (typeof bin !== "string" || !Object.hasOwn(BANKS, bin) ||
      !/^[A-Za-z0-9]{1,19}$/.test(account) || holder.length < 2 || holder.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(holder) || typeof enabled !== "boolean") {
    return error("Kiểm tra lại ngân hàng, số tài khoản và tên chủ tài khoản.", 400);
  }
  if (secret && !/^[!-~]{32,256}$/.test(secret)) return error("Secret Key SePay cần 32–256 ký tự, không có khoảng trắng.", 400);
  const cipher = secret ? await seal(env, secret, "sepay:v1") : null;
  const saved = await env.DB.prepare(
    "INSERT INTO bank_transfer_settings (id, bank_bin, account_number, account_holder, enabled, sepay_secret) VALUES (1, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET bank_bin=excluded.bank_bin, account_number=excluded.account_number, " +
    "account_holder=excluded.account_holder, enabled=excluded.enabled, sepay_secret=COALESCE(excluded.sepay_secret, sepay_secret), " +
    "verified_at=CASE WHEN excluded.sepay_secret IS NOT NULL OR excluded.bank_bin<>bank_bin OR excluded.account_number<>account_number " +
    "THEN NULL ELSE verified_at END WHERE (excluded.bank_bin=bank_bin AND excluded.account_number=account_number) OR " +
    "NOT EXISTS(SELECT 1 FROM bank_topups WHERE bin=bank_bin AND account=account_number AND paid_at IS NULL AND created_at>?) RETURNING id"
  ).bind(bin, account, holder, Number(enabled), cipher, Date.now() - topupLifetime).first();
  if (!saved) return error("Vẫn còn QR trong 24 giờ đang chờ thanh toán. Bạn có thể tắt tạo QR mới trước khi đổi tài khoản.", 409);
  return json({ settings: await bankSettingsForOwner(env.DB) });
}

async function startTopup(env, owner, amount) {
  if (!inRange(amount, 1, maxTopup)) return error("Nhập số tiền chuyển khoản hợp lệ.", 400);
  const settings = await getBankSettings(env.DB);
  if (!paymentReady(env, settings)) return error("Nạp tiền tự động chưa được bật.", 409);
  const now = Date.now();
  const existing = await env.DB.prepare(
    "SELECT reference, amount, bin, account, holder FROM bank_topups WHERE owner_hash=? AND amount=? AND bin=? AND account=? " +
    "AND paid_at IS NULL AND created_at>? ORDER BY created_at DESC LIMIT 1"
  ).bind(owner, amount, settings.bin, settings.account, now - 1800000).first();
  if (existing) return json({ topup: { reference: existing.reference, amount, receiver: receiver(existing) } });
  const reference = "ZIKO" + toHex(crypto.getRandomValues(new Uint8Array(6))).toUpperCase();
  const created = await env.DB.prepare(
    "INSERT INTO bank_topups (reference, owner_hash, amount, bin, account, holder, created_at) " +
    "SELECT ?, ?, ?, bank_bin, account_number, account_holder, ? FROM bank_transfer_settings " +
    "WHERE id=1 AND enabled=1 AND verified_at IS NOT NULL AND sepay_secret=? AND bank_bin=? AND account_number=? " +
    "AND (SELECT COUNT(*) FROM bank_topups WHERE owner_hash=? AND created_at>? AND paid_at IS NULL)<15 RETURNING reference"
  ).bind(reference, owner, amount, now, settings.sepay_secret, settings.bin, settings.account, owner, now - topupLifetime).first();
  if (!created) return error("Chưa tạo được QR. Hãy dùng mã đang chờ hoặc thử lại sau.", 409);
  return json({ topup: { reference, amount, receiver: receiver(settings) } }, 201);
}

async function topupStatus(env, owner) {
  const [rows, balance] = await Promise.all([
    env.DB.prepare(
      "SELECT reference, amount, bin, account, holder, created_at, paid_at, code_cipher, redeemed_at FROM bank_topups " +
      "WHERE owner_hash=? ORDER BY created_at DESC LIMIT 20"
    ).bind(owner).all(),
    walletBalance(env.DB, owner),
  ]);
  const topups = await Promise.all(rows.results.map(async (row) => {
    const { reference, amount } = row;
    if (!row.paid_at && row.created_at <= Date.now() - topupLifetime) return { reference, amount, status: "expired" };
    if (!row.paid_at) return { reference, amount, status: "pending", receiver: receiver(row) };
    if (row.redeemed_at) return { reference, amount, status: "redeemed" };
    return { reference, amount, status: "paid", code: await unseal(env, row.code_cipher, "code:" + reference) };
  }));
  return json({ topups, balance });
}

async function redeemTopup(env, owner, value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!transferCodePattern.test(code)) return error("Mã nạp ngân hàng không hợp lệ.", 400);
  const row = await env.DB.prepare(
    "UPDATE bank_topups SET redeemed_by=?, redeemed_at=COALESCE(redeemed_at,?) " +
    "WHERE code_hash=? AND paid_at IS NOT NULL AND (redeemed_by IS NULL OR redeemed_by=?) RETURNING amount"
  ).bind(owner, Date.now(), await hashCode(code), owner).first();
  return row ? json(row) : error("Mã nạp không hợp lệ hoặc đã được dùng ở ví khác.", 409);
}

async function verifySepay(request, secret, raw) {
  const timestamp = request.headers.get("x-sepay-timestamp") ?? "";
  const signature = request.headers.get("x-sepay-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/i.test(signature) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, hexBytes(signature.slice(7)), textEncoder.encode(timestamp + "." + raw));
}

function paymentReference(data) {
  const reported = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
  if (referencePattern.test(reported)) return reported;
  const matches = new Set((typeof data.content === "string" ? data.content.toUpperCase() : "").match(/ZIKO[A-F0-9]{12}(?![A-Z0-9])/g));
  return matches.size === 1 ? [...matches][0] : null;
}

const normalizedBank = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/BANK$/, "");

async function receiveSepay(request, env) {
  if (request.method !== "POST") return error("Phương thức không hợp lệ.", 405);
  if (!request.headers.has("x-sepay-signature")) return error("Webhook chưa được xác thực.", 401);
  const settings = await getBankSettings(env.DB);
  if (!settings?.sepay_secret) return error("Chưa cấu hình webhook SePay.", 503);
  const raw = await readJsonText(request);
  if (!raw) return error("Dữ liệu webhook không hợp lệ.", 400);
  const secret = await unseal(env, settings.sepay_secret, "sepay:v1");
  if (!(await verifySepay(request, secret, raw))) return error("Chữ ký webhook không hợp lệ.", 401);
  const data = parseObject(raw);
  if (!data) return error("Dữ liệu webhook không hợp lệ.", 400);
  const transactionId = typeof data.id === "number" && Number.isSafeInteger(data.id) ? String(data.id) : data.id;
  const gateway = typeof data.gateway === "string" ? normalizedBank(data.gateway) : "";
  const reportedBank = gateway && Object.keys(BANKS).find((bin) => normalizedBank(BANKS[bin]) === gateway);
  if (data.transferType !== "in" || data.accountNumber !== settings.account ||
      (reportedBank && reportedBank !== settings.bin) ||
      typeof transactionId !== "string" || !/^\d{1,20}$/.test(transactionId) ||
      !inRange(data.transferAmount, 1, maxTopup)) return json({ success: true });
  const now = Date.now();
  const reference = paymentReference(data);
  if (reference) {
    const code = "ZK-" + toHex(crypto.getRandomValues(new Uint8Array(16))).toUpperCase();
    await env.DB.prepare(
      "UPDATE bank_topups SET transaction_id=?, paid_at=?, code_hash=?, code_cipher=? " +
      "WHERE reference=? AND amount=? AND bin=? AND account=? AND paid_at IS NULL " +
      "AND NOT EXISTS(SELECT 1 FROM bank_topups WHERE transaction_id=?)"
    ).bind(transactionId, now, await hashCode(code), await seal(env, code, "code:" + reference),
      reference, data.transferAmount, settings.bin, settings.account, transactionId).run();
  }
  if (!settings.verified_at) {
    await env.DB.prepare("UPDATE bank_transfer_settings SET verified_at=? WHERE id=1 AND bank_bin=? AND account_number=? AND sepay_secret=? AND verified_at IS NULL")
      .bind(now, settings.bin, settings.account, settings.sepay_secret).run();
  }
  return json({ success: true });
}
