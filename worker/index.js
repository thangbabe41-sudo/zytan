const imageFiles = new Set([
  "brand.svg", "giay-tuyet-sac.webp", "nak-loi.webp", "ryoma.webp",
  "veres.webp", "combo-nak.webp", "trieu-van.webp", "liliana.webp",
]);
const walletPattern = /^[0-9a-f]{48}$/;
const idPattern = /^[0-9a-f-]{36}$/;
const productFields = "id, name, price, stock, photo, active, updated_at, kind";
const defaultAccountsById = new Map(ACCOUNT_DEFAULTS.map((item) => [item.id, item]));

function json(data, status = 200) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

function error(message, status) {
  return json({ error: message }, status);
}

function asset(path, method) {
  const entry = Object.hasOwn(FILES, path) && FILES[path];
  if (!entry) return new Response("Không tìm thấy trang.", { status: 404 });
  const bytes = method === "HEAD" ? null : Uint8Array.from(atob(entry.base64), (character) => character.charCodeAt(0));
  return new Response(bytes, { headers: {
    "Content-Type": entry.type,
    "Cache-Control": path.startsWith("/admin") ? "no-store" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  } });
}

function adminStatus(request, env) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!id || !email) return 401;
  return email === env.ADMIN_OWNER_EMAIL ? 200 : 403;
}

async function readJsonText(request, limit = 4096) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const inRange = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const toHex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const hashCode = async (value) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

async function catalogItems(db, overrides) {
  const [{ results }, inventory] = await Promise.all([
    db.prepare("SELECT " + productFields + " FROM catalog_accounts ORDER BY updated_at DESC").all(),
    stockCounts(db),
  ]);
  const saved = new Map(results.map((item) => [item.id, item]));
  return results.filter((item) => !defaultAccountsById.has(item.id)).concat(
    ACCOUNT_DEFAULTS.map((item) => ({
      ...item, price: overrides[item.id]?.[0] ?? item.price, stock: 0, active: 1, kind: "account", ...saved.get(item.id),
    })),
  ).map((item) => item.kind === "account" ? { ...item, stock: inventory.get(item.id) ?? 0 } : item);
}

async function saveProduct(db, data) {
  const { id, price, stock, photo, active, kind } = data;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const defaultAccount = defaultAccountsById.has(id);
  if (name.length < 2 || name.length > 100 || !inRange(price, 1, 100000000) ||
      !inRange(stock, 0, 100000) || !imageFiles.has(photo) || typeof active !== "boolean" ||
      (kind !== undefined && kind !== "account" && kind !== "other") ||
      (id !== undefined && !defaultAccount && (typeof id !== "string" || !idPattern.test(id)))) {
    return error("Kiểm tra tên mặt hàng, loại, giá, số lượng và ảnh bìa.", 400);
  }
  const values = [name, price, stock, photo, Number(active), Date.now()];
  if (id && !defaultAccount) {
    const updated = await db.prepare(
      "UPDATE catalog_accounts SET name=?, price=?, stock=?, photo=?, active=?, updated_at=?, kind=COALESCE(?, kind) WHERE id=? RETURNING id",
    ).bind(...values, kind ?? null, id).first();
    return updated ? json(updated) : error("Không tìm thấy mặt hàng.", 404);
  }
  const productId = id ?? crypto.randomUUID();
  const insert = "INSERT INTO catalog_accounts (name, price, stock, photo, active, updated_at, id, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  if (defaultAccount) {
    await db.prepare(insert +
      " ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price, stock=excluded.stock, photo=excluded.photo," +
      " active=excluded.active, updated_at=excluded.updated_at, kind=COALESCE(?, catalog_accounts.kind)",
    ).bind(...values, productId, kind ?? "account", kind ?? null).run();
  } else {
    await db.prepare(insert).bind(...values, productId, kind ?? "account").run();
  }
  return json({ id: productId }, defaultAccount ? 200 : 201);
}

function normalizeZaloContact(value) {
  if (typeof value !== "string" || value.length > 150) return null;
  const contact = value.trim();
  if (!contact) return "";
  const phone = contact.replace(/[\s().-]/g, "");
  if (/^0\d{9}$/.test(phone)) return "https://zalo.me/" + phone;
  if (/^\+?84[1-9]\d{8}$/.test(phone)) return "https://zalo.me/0" + phone.slice(-9);
  const link = contact.match(/^(?:https:\/\/)?zalo\.me\/((?:g\/)?[a-z\d_-]{2,64})\/?$/i);
  return link ? "https://zalo.me/" + link[1] : null;
}

async function getSupportContact(env) {
  const row = await env.DB.prepare("SELECT zalo_url AS zaloUrl FROM site_support_settings WHERE id=1").first();
  return { zaloUrl: row?.zaloUrl ?? normalizeZaloContact(env.ZALO_SUPPORT_CONTACT) ?? "" };
}

async function saveSupportContact(db, data) {
  const zaloUrl = normalizeZaloContact(data.zalo);
  if (zaloUrl === null) return error("Nhập số điện thoại Zalo hoặc link bắt đầu bằng https://zalo.me/.", 400);
  await db.prepare("INSERT INTO site_support_settings (id, zalo_url) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET zalo_url=excluded.zalo_url")
    .bind(zaloUrl).run();
  return json({ zaloUrl });
}

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  if (path === "/api/webhooks/sepay") return receiveSepay(request, env);
  if (path === "/api/member/session" && method === "GET") return json({ member: await getMember(request, db) });
  if (path === "/api/catalog" && method === "GET") {
    const prices = await priceOverrides(db);
    const accounts = await catalogItems(db, prices);
    return json({ accounts: accounts.filter((item) => item.active), prices });
  }
  if (path === "/api/payment" && method === "GET") {
    const settings = await getBankSettings(db);
    return json({ payment: paymentReady(env, settings) ? receiver(settings) : null });
  }
  if (path === "/api/support" && method === "GET") return json(await getSupportContact(env));
  if (method === "GET" && (path === "/api/orders" || path.startsWith("/api/orders/"))) {
    const member = await getMember(request, db);
    if (!member) return error("Đăng nhập Ziko để xem đơn đã mua.", 401);
    if (path === "/api/orders") return listOrders(db, member.id, url.searchParams);
    const id = path.slice("/api/orders/".length);
    const row = uuidPattern.test(id) && await orderRow(db, member.id, id);
    return row ? orderReceipt(env, row) : error("Không tìm thấy đơn mua.", 404);
  }
  if (path.startsWith("/api/admin/")) {
    const status = adminStatus(request, env);
    if (status !== 200) return error(status === 401 ? "Đăng nhập ChatGPT để quản trị." : "Mục này dành cho chủ website.", status);
    if (method === "GET" && path === "/api/admin/catalog") {
      return json({ accounts: await catalogItems(db, await priceOverrides(db)) });
    }
    if (method === "GET" && path === "/api/admin/payment") return json({ settings: await bankSettingsForOwner(db) });
    if (method === "GET" && path === "/api/admin/prices") return json({ items: await priceEditor(db) });
    if (method === "GET" && path === "/api/admin/support") return json(await getSupportContact(env));
    if (method === "GET" && path === "/api/admin/stock") {
      return stockForAdmin(db, url.searchParams.get("product"), Number(url.searchParams.get("offset") ?? 0));
    }
  }
  if (method !== "POST") return error("Không tìm thấy chức năng.", 404);
  if (request.headers.get("origin") !== url.origin) return error("Yêu cầu phải được gửi từ website này.", 403);
  const data = parseObject(await readJsonText(request, path === "/api/admin/stock/import" ? 65536 : undefined));
  if (!data) return error("Dữ liệu gửi lên không hợp lệ.", 400);
  switch (path) {
    case "/api/admin/catalog": return saveProduct(db, data);
    case "/api/admin/prices": return savePrice(db, data);
    case "/api/admin/payment": return saveBankSettings(env, data);
    case "/api/admin/support": return saveSupportContact(db, data);
    case "/api/admin/stock": return addStock(env, data);
    case "/api/admin/stock/import": return importStock(env, data);
    case "/api/admin/stock/remove": return removeStock(db, data.id);
    case "/api/orders": {
      const member = await getMember(request, db);
      return member && member.id === data.memberId ? purchaseAccount(env, member, data) :
        error("Đăng nhập lại đúng tài khoản Ziko để mua acc.", 401);
    }
    case "/api/member/register": return memberAuth(request, db, data, true);
    case "/api/member/login": return memberAuth(request, db, data, false);
    case "/api/member/logout": return signOutMember(request, db);
    case "/api/payment/start":
    case "/api/payment/status":
    case "/api/payment/redeem": {
      const owner = await bankOwner(request, db, data);
      if (!owner) return data.memberId != null ? error("Hãy đăng nhập lại để mở ví ngân hàng.", 401) : error("Ví không hợp lệ.", 400);
      if (path.endsWith("/start")) return startTopup(env, owner, data.amount);
      if (path.endsWith("/redeem")) return redeemTopup(env, owner, data.code);
      return topupStatus(env, owner);
    }
    default: return error("Không tìm thấy chức năng.", 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname.startsWith("/api/")) return await api(request, env, url);
      if (request.method !== "GET" && request.method !== "HEAD") return error("Phương thức không hợp lệ.", 405);
      if (pathname === "/admin.js") {
        const status = adminStatus(request, env);
        if (status !== 200) return error("Mục này dành cho chủ website.", status);
      }
      if (pathname === "/admin" || pathname === "/admin.html") {
        const status = adminStatus(request, env);
        if (status === 401) return new Response(null, { status: 302, headers: {
          "Location": "/signin-with-chatgpt?return_to=%2Fadmin", "Cache-Control": "no-store",
        } });
        if (status !== 200) return error("Mục này dành cho chủ website.", status);
        return asset("/admin.html", request.method);
      }
      return asset(pathname === "/" ? "/index.html" : pathname, request.method);
    } catch {
      return error("Hệ thống đang bận. Vui lòng thử lại.", 503);
    }
  },
};
