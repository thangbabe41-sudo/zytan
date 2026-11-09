const imageFiles = new Set([
  "brand.svg", "giay-tuyet-sac.webp", "nak-loi.webp", "ryoma.webp",
  "veres.webp", "combo-nak.webp", "trieu-van.webp", "liliana.webp",
]);
const walletPattern = /^[0-9a-f]{48}$/;
const idPattern = /^[0-9a-f-]{36}$/;
const productFields = "id, name, price, stock, photo, active, updated_at";

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

async function readJsonText(request) {
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
    if (size > 4096) {
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

async function saveProduct(db, data) {
  const { id, price, stock, photo, active } = data;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name.length < 2 || name.length > 100 || !inRange(price, 1, 100000000) ||
      !inRange(stock, 0, 100000) || !imageFiles.has(photo) || typeof active !== "boolean" ||
      (id !== undefined && (typeof id !== "string" || !idPattern.test(id)))) {
    return error("Kiểm tra tên acc, giá, số lượng và ảnh bìa.", 400);
  }
  const values = [name, price, stock, photo, Number(active), Date.now()];
  if (id) {
    const updated = await db.prepare("UPDATE catalog_accounts SET name=?, price=?, stock=?, photo=?, active=?, updated_at=? WHERE id=? RETURNING id")
      .bind(...values, id).first();
    return updated ? json(updated) : error("Không tìm thấy mẫu acc.", 404);
  }
  const productId = crypto.randomUUID();
  await db.prepare("INSERT INTO catalog_accounts (name, price, stock, photo, active, updated_at, id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(...values, productId).run();
  return json({ id: productId }, 201);
}

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  if (path === "/api/webhooks/sepay") return receiveSepay(request, env);
  if (path === "/api/member/session" && method === "GET") return json({ member: await getMember(request, db) });
  if (path === "/api/catalog" && method === "GET") {
    const [result, prices] = await Promise.all([
      db.prepare("SELECT " + productFields + " FROM catalog_accounts WHERE active=1 ORDER BY updated_at DESC").all(),
      priceOverrides(db),
    ]);
    return json({ accounts: result.results, prices });
  }
  if (path === "/api/payment" && method === "GET") {
    const settings = await getBankSettings(db);
    return json({ payment: paymentReady(env, settings) ? receiver(settings) : null });
  }
  if (path.startsWith("/api/admin/")) {
    const status = adminStatus(request, env);
    if (status !== 200) return error(status === 401 ? "Đăng nhập ChatGPT để quản trị." : "Mục này dành cho chủ website.", status);
    if (method === "GET" && path === "/api/admin/catalog") {
      const result = await db.prepare("SELECT " + productFields + " FROM catalog_accounts ORDER BY updated_at DESC").all();
      return json({ accounts: result.results });
    }
    if (method === "GET" && path === "/api/admin/payment") return json({ settings: await bankSettingsForOwner(db) });
    if (method === "GET" && path === "/api/admin/prices") return json({ items: await priceEditor(db) });
  }
  if (method !== "POST") return error("Không tìm thấy chức năng.", 404);
  if (request.headers.get("origin") !== url.origin) return error("Yêu cầu phải được gửi từ website này.", 403);
  const data = parseObject(await readJsonText(request));
  if (!data) return error("Dữ liệu gửi lên không hợp lệ.", 400);
  switch (path) {
    case "/api/admin/catalog": return saveProduct(db, data);
    case "/api/admin/prices": return savePrice(db, data);
    case "/api/admin/payment": return saveBankSettings(env, data);
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
