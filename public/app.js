"use strict";

import { packages as defaultPackages, sales as defaultSales, roles } from "./catalog-data.js";

let packages = defaultPackages;
let sales = defaultSales;
const guestStorageKey = "chung-suc-lq-demo-v1";
const guestWalletKey = "chung-suc-lq-wallet-v1";
const sessionNoticeKey = "ziko-session-notice";
let storageKey = guestStorageKey;
let member = null;
let authRevision = 0;
let authBusy = false;
const processTime = 30000;
const number = new Intl.NumberFormat("vi-VN");
const dateTime = new Intl.DateTimeFormat("vi-VN", {dateStyle: "short", timeStyle: "short"});
const shortTime = new Intl.DateTimeFormat("vi-VN", {hour: "2-digit", minute: "2-digit"});
const $ = (selector) => document.querySelector(selector);
const dialog = $("#dialog");
const body = $("#dialog-body");
let products = [];
let state = readState() ?? initialState();
let filter = "all";
let screen = "";
let toastTimer;

function initialState() {
  return { profile: "", orders: [] };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.orders)) return saved;
  } catch {
    // The demo also runs when storage is unavailable.
  }
}

function save(nextState) {
  state = nextState;
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Keep state in memory. */ }
  renderPage();
}

function locked(name, action) {
  return navigator.locks ? navigator.locks.request(name, action) : Promise.resolve().then(action);
}

function updateLocal(change, scope = storageKey) {
  return locked(scope, () => {
    if (scope !== storageKey) return false;
    state = readState() ?? state;
    const next = change(state);
    if (next) save(next);
    return Boolean(next);
  });
}

const currency = (amount) => number.format(amount) + " Xu";
const dong = (amount) => number.format(amount) + " ₫";
const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="assets/icons.svg#' + name + '"/></svg>';
const safe = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const remainingSale = (sale) => Math.max(0, sale.stock - state.orders
  .filter((order) => order.productId === sale.id)
  .reduce((total, order) => total + order.quantity, 0));
const finished = (order) => Date.now() - order.at >= processTime;

function button(label, action, value, style = "primary") {
  return '<button type="button" class="btn ' + style + '" data-action="' + action + '"' +
    (value ? ' data-id="' + value + '"' : "") + '>' + label + '</button>';
}

function price(amount, unit) {
  return '<div class="price">' + currency(amount) + (unit ? '<small>/ ' + unit + '</small>' : "") + '</div>';
}

const mascotImage = '<img loading="lazy" src="assets/ziko-mascot.png" alt="" width="1692" height="1619">';
const mascotBanner = mascotImage + '<span class="banner-wordmark" aria-hidden="true">Ziko</span>';

function flashCard(item) {
  const product = packages.find((entry) => entry.id === item.packageId);
  const stock = remainingSale(item);
  const discount = Math.round((1 - item.price / item.oldPrice) * 100);
  return '<article class="flash-card"><div class="flash-media mascot-banner">' + mascotImage + '<span class="discount">−' +
    discount + '%</span></div><div class="flash-data"><h3>' + product.name + '</h3><div class="price">' +
    currency(item.price) + ' <del>' + currency(item.oldPrice) + '</del><small>/ mã</small></div><div class="progress" aria-hidden="true">' +
    '<span style="--progress:' + Math.min(100, stock / 80) + '%"></span></div><span class="stock">Còn ' +
    number.format(stock) + ' lượt</span></div>' +
    (stock ? button("Mua ngay", "sale", item.id) : '<button class="btn outline" disabled>Hết lượt</button>') + '</article>';
}

const productUnit = (item) => item.kind === "other" ? "món" : "acc";

function productCard(item) {
  const stock = item.stock;
  const branded = item.photo === "brand.svg";
  const art = branded ? mascotBanner : '<img loading="lazy" src="assets/' + safe(item.photo) + '" alt="">';
  const tags = item.kind === "other" ? '<span class="badge">Hàng khác</span>' :
    '<span class="badge">' + icon("shield") + ' Acc Reg</span><span class="badge">' + icon("mail") + ' Giao tự động</span>';
  return '<article class="product' + (item.featured ? " hot" : "") + '"><div class="product-media' +
    (branded ? " mascot-banner" : "") + '">' + art +
    '<div class="product-tags">' + tags + '</div><span class="badge' + (stock < 10 ? " low" : "") + '">' +
    (stock ? "Còn " + number.format(stock) + " " + productUnit(item) : "Hết hàng") + '</span></div><div class="product-body"><h3>' + safe(item.name) +
    '</h3>' + (item.featured ? '<span class="hot-text">🔥 Sản phẩm nổi bật</span>' : "") + price(item.price, productUnit(item)) +
    (stock ? button("Mua ngay", "product", item.id) : '<button class="btn outline" disabled>Hết hàng</button>') + '</div></article>';
}

function packageCard(item) {
  return '<article class="product catalog-card"><div class="product-media mascot-banner">' + mascotBanner +
    '<span class="badge">Chung sức</span></div><div class="product-body"><h3>' + item.name + '</h3><p>' + item.detail + '</p>' +
    price(item.prices[0], "mã") + '<div class="rates">' + item.prices.map((amount, index) =>
      '<span>' + (index === 0 ? "Thường" : roles[index]) + '<strong>' + currency(amount) + '</strong></span>'
    ).join("") + '</div>' + button("Đặt đơn trực tuyến", "order", item.id) + '</div></article>';
}

function renderCatalog() {
  document.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.filter === filter)));
  const packageCards = filter === "all" || filter === "package" ? packages.map(packageCard).join("") : "";
  const productCards = products.filter((item) => filter === "all" || item.kind === filter).map(productCard).join("");
  $("#catalog-grid").innerHTML = (packageCards + productCards) || "<p>Chưa có mặt hàng trong mục này.</p>";
}

function renderRecent() {
  const sample = [
    { name: "Full 3 Rương", quantity: 1, example: "Mẫu 01", done: false },
    { name: "Full 3 Rương", quantity: 1, example: "Mẫu 02", done: true },
    { name: "1 Rương SS", quantity: 2, example: "Mẫu 03", done: true },
  ];
  const orders = state.orders.slice(0, 3);
  const recent = orders.concat(sample.slice(0, 3 - orders.length));
  $("#recent-orders").innerHTML = recent.map((order) => {
    const done = order.example ? order.done : finished(order);
    const caption = order.example || order.id + " · " + shortTime.format(order.at);
    return '<div class="recent-item"><span class="stat-icon">' + icon(done ? "check" : "cube") +
      '</span><div class="recent-data"><strong>' + safe(order.name) + ' ×' + order.quantity + '</strong><small>' +
      safe(caption) + '</small><div class="progress" aria-hidden="true"><span style="--progress:' +
      (done ? 100 : 55) + '%"></span></div></div><span class="badge' + (done ? "" : " pending") + '">' +
      (done ? "Xong" : "Đang chạy") + '</span></div>';
  }).join("");
  $("#stat-orders").textContent = number.format(state.orders.length);
  $("#stat-waiting").textContent = number.format(state.orders.filter((order) => !finished(order)).length);
}

function renderPage() {
  $("#flash-grid").innerHTML = sales.map(flashCard).join("");
  $("#account-grid").innerHTML = products.filter((item) => item.kind === "account").map(productCard).join("");
  $("#profile-label").textContent = member ? "Hồ sơ" : "Đăng nhập";
  $("#signup-label").textContent = member ? "Lịch sử" : "Đăng ký";
  renderRecent();
  renderCatalog();
  renderRoles();
}

async function refreshCatalog() {
  const response = await fetch("/api/catalog");
  if (!response.ok) return;
  const result = await response.json();
  const overrides = result.prices ?? {};
  packages = defaultPackages.map((item) => ({ ...item, prices: overrides[item.id] ?? item.prices }));
  sales = defaultSales.map((item) => {
    const amounts = overrides[item.id];
    return amounts ? { ...item, price: amounts[0], oldPrice: amounts[1] } : item;
  });
  products = result.accounts.map((item) => ({
    ...item, productId: item.id, id: item.id.length === 36 ? "acc-" + item.id : item.id, kind: item.kind ?? "account",
  }));
  renderPage();
}

function renderRoles() {
  $("#role-grid").innerHTML = roles.map((role, index) => '<article class="role-card"><span class="eyebrow">' + role.toLocaleUpperCase("vi") +
    '</span><h3>' + ["Giá niêm yết", "Cộng tác viên", "Đại lý"][index] + '</h3>' +
    packages.map((item) => '<div class="role-price"><span>' + item.name + '</span><strong>' +
      currency(item.prices[index]) + '</strong></div>').join("") + '</article>').join("");
}

function open(title, html, type = "") {
  screen = type;
  $("#dialog-title").textContent = title;
  body.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  body.querySelector("textarea, input, select, button, a")?.focus();
}

function toast(message) {
  const target = $("#toast");
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, 4000);
}

function showError(message) {
  body.querySelector(".form-error").textContent = message;
}

async function placeOrder(productId, name, quantity, total) {
  const scope = storageKey;
  const id = "CS-" + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(7, "0");
  const order = { id, productId, name, quantity, total, at: Date.now() };
  const sale = sales.find((item) => item.id === productId);
  const product = products.find((item) => item.id === productId);
  const stored = await updateLocal((current) => {
    const stock = sale ? remainingSale(sale) : product?.stock;
    if (stock !== undefined && stock < quantity) return null;
    return { ...current, orders: [order, ...current.orders] };
  }, scope);
  if (scope !== storageKey || !dialog.open) return;
  if (!stored) {
    showError("Số lượng đã vượt số lượt còn lại.");
    return;
  }
  open("Đã tạo đơn thử", '<p class="note">Mã đơn <strong>' + id + '</strong> đã được lưu. Trạng thái mô phỏng sẽ hoàn tất sau 30 giây.</p>' +
    '<div class="inline-actions">' + button("Xem lịch sử", "history") + '</div>');
}

async function submitOrder(form, productId, name, quantity, total) {
  const confirm = form.querySelector('button[type="submit"]');
  confirm.disabled = true;
  try {
    await placeOrder(productId, name, quantity, total);
  } finally {
    confirm.disabled = false;
  }
}

function orderForm(id, sale = null) {
  const selected = packages.find((item) => item.id === id) || packages[2];
  const choices = sale ? [selected] : packages;
  open(sale ? "Đặt đơn Flash Sale" : "Tạo đơn chung sức", '<form class="dialog-form">' +
    '<p class="note">Đây là đơn mô phỏng. Dùng mã ví dụ như LQ123ABC để xem cách tính giá.</p>' +
    '<label>Gói chung sức<select name="product">' + choices.map((item) => '<option value="' + item.id + '"' +
      (item.id === selected.id ? " selected" : "") + '>' + item.name + ' · ' + currency(sale?.price ?? item.prices[0]) + '/mã</option>').join("") +
    '</select></label><label>Mã sự kiện<textarea name="codes" placeholder="LQ123ABC" rows="4" maxlength="10000" required></textarea></label>' +
    '<div class="dialog-summary" aria-live="polite"></div><div class="form-error" role="alert"></div>' +
    '<button type="submit" class="btn primary">Xác nhận đơn mô phỏng</button></form>');
  const form = body.querySelector("form");
  function update() {
    const product = choices.find((item) => item.id === form.elements.product.value);
    const lines = form.elements.codes.value.split(/\r?\n/).map((line) => line.trim().toUpperCase()).filter(Boolean);
    const valid = lines.filter((line) => /^[A-Z0-9_-]{3,100}$/.test(line));
    const quantity = new Set(valid).size;
    const invalid = lines.length - valid.length;
    const duplicates = valid.length - quantity;
    const total = quantity * (sale?.price ?? product.prices[0]);
    const stock = sale ? remainingSale(sale) : 100;
    form.querySelector(".dialog-summary").innerHTML = '<span>' + quantity +
      ' mã hợp lệ' + (duplicates ? ' · ' + duplicates + ' mã trùng' : "") + (invalid ? ' · ' + invalid + ' mã sai định dạng' : "") +
      (sale ? ' · Còn ' + number.format(stock) + ' lượt' : '') + '</span><strong>Tổng ' + currency(total) + '</strong>';
    return { product, quantity, total, invalid, stock };
  }
  form.addEventListener("input", () => { showError(""); update(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const order = update();
    if (order.invalid) return showError("Mã cần có 3–100 ký tự, gồm chữ A–Z, số, dấu gạch ngang hoặc gạch dưới.");
    if (!order.quantity) return showError("Hãy nhập ít nhất một mã hợp lệ.");
    if (order.quantity > Math.min(100, order.stock)) return showError("Số lượng vượt giới hạn của đơn hoặc số lượt còn lại.");
    void submitOrder(form, sale?.id ?? order.product.id, order.product.name, order.quantity, order.total);
  });
  update();
}

function productForm(id) {
  const item = products.find((product) => product.id === id);
  if (!item?.stock) return;
  if (item.kind === "account") return checkout(item);
  const stock = item.stock;
  open("Mua hàng", '<form class="dialog-form"><p class="note">Đây là đơn mô phỏng. Bạn có thể chọn số lượng để xem giá.</p><h3>' + safe(item.name) +
    '</h3><label>Số lượng<input name="quantity" type="number" value="1" min="1" max="' + stock + '" step="1" required></label>' +
    '<div class="dialog-summary" aria-live="polite"></div><div class="form-error" role="alert"></div>' +
    '<button type="submit" class="btn primary">Xác nhận đơn mô phỏng</button></form>');
  const form = body.querySelector("form");
  function update() {
    const quantity = form.elements.quantity.valueAsNumber;
    const total = Number.isInteger(quantity) && quantity > 0 ? quantity * item.price : 0;
    form.querySelector(".dialog-summary").innerHTML = '<span>Còn ' + number.format(stock) +
      ' ' + productUnit(item) + '</span><strong>Tổng ' + currency(total) + '</strong>';
    return { quantity, total };
  }
  form.addEventListener("input", () => { showError(""); update(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const order = update();
    if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > stock) return showError("Số lượng vượt tồn kho.");
    void submitOrder(form, item.id, item.name, order.quantity, order.total);
  });
  update();
}

async function orderRequest(path = "", data) {
  const options = data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  };
  const response = await fetch("/api/orders" + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Không tải được đơn mua.");
  return result;
}

function checkout(item) {
  if (!member) return authForm(false, () => checkout(item));
  const memberId = member.id;
  const pendingKey = "ziko-purchase:" + memberId + ":" + item.productId + ":" + item.price;
  let requestId = crypto.randomUUID();
  open("Thanh toán acc", '<form class="dialog-form" method="post"><h3>' + safe(item.name) + '</h3>' +
    '<p class="note">Mua 1 acc bằng số dư Ziko. Acc sẽ hiện ngay sau khi thanh toán.</p>' +
    '<div class="dialog-summary"><span>Trừ từ số dư</span><strong>' + dong(item.price) + '</strong></div>' +
    '<div class="form-error" role="alert"></div><div class="inline-actions">' +
    '<button type="submit" class="btn primary">Thanh toán ' + dong(item.price) + '</button>' +
    button("Nạp tiền", "wallet", null, "outline") + button("Đơn đã mua", "purchases", null, "outline") + '</div></form>');
  const form = body.querySelector("form");
  const confirm = form.querySelector('button[type="submit"]');
  const issue = form.querySelector(".form-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (confirm.disabled) return;
    confirm.disabled = true;
    issue.textContent = "";
    try {
      const { order } = await locked(pendingKey, async () => {
        if (member?.id !== memberId) throw new Error("Đăng nhập lại đúng tài khoản Ziko để mua acc.");
        try {
          requestId = localStorage.getItem(pendingKey) || requestId;
          localStorage.setItem(pendingKey, requestId);
        } catch { /* Keep the request ID in memory for this dialog. */ }
        const result = await orderRequest("", { memberId, requestId, productId: item.productId, price: item.price });
        try { localStorage.removeItem(pendingKey); } catch { /* The receipt is saved on the server. */ }
        return result;
      });
      refreshCatalog().catch(() => {});
      if (form.isConnected && dialog.open && member?.id === memberId) showReceipt(order);
    } catch (error) {
      issue.textContent = error.message;
      refreshCatalog().catch(() => {});
    } finally {
      confirm.disabled = false;
    }
  });
}

function showReceipt(order) {
  const { account } = order;
  open("Đã thanh toán", '<h3>' + safe(order.title) + '</h3><p class="note">' +
    dong(order.amount) + ' · ' + dateTime.format(order.created_at) + '</p>' +
    '<dl class="order-receipt"><dt>Tên đăng nhập acc</dt><dd>' + safe(account.login) +
    '</dd><dt>Mật khẩu acc</dt><dd>' + safe(account.password) + '</dd>' +
    (account.note ? '<dt>Ghi chú bàn giao</dt><dd>' + safe(account.note) + '</dd>' : '') +
    '</dl><div class="inline-actions">' + button("Đơn đã mua", "purchases") + '</div>', "receipt");
}

async function viewPurchase(id) {
  if (!member) return authForm(false, () => viewPurchase(id));
  const memberId = member.id;
  open("Đơn đã mua", '<p role="status">Đang tải acc…</p>');
  const status = body.firstElementChild;
  try {
    const { order } = await orderRequest("/" + encodeURIComponent(id));
    if (status.isConnected && dialog.open && member?.id === memberId) showReceipt(order);
  } catch (issue) {
    status.textContent = issue.message;
  }
}

async function purchases() {
  if (!member) return authForm(false, purchases);
  const memberId = member.id;
  open("Đơn đã mua", '<p role="status"></p><ul class="history-list"></ul>' +
    '<button type="button" class="btn outline" hidden>Xem thêm</button>');
  const status = body.querySelector('[role="status"]');
  const list = body.querySelector("ul");
  const next = body.querySelector("button");
  let cursor;
  async function load() {
    next.disabled = true;
    status.textContent = "Đang tải đơn đã mua…";
    try {
      const query = cursor ? "?" + new URLSearchParams(cursor) : "";
      const { orders, more } = await orderRequest(query);
      if (!list.isConnected || !dialog.open || member?.id !== memberId) return;
      list.insertAdjacentHTML("beforeend", orders.map((order) => '<li><div><strong>' +
        safe(order.title) + '</strong><small>' + dateTime.format(order.created_at) + ' · ' + dong(order.amount) +
        '</small></div>' + button("Xem acc", "receipt", order.id, "outline") + '</li>').join(""));
      status.textContent = list.children.length ? "" : "Chưa có acc đã mua.";
      cursor = more;
      next.hidden = !more;
    } catch (issue) {
      status.textContent = issue.message;
    } finally {
      next.disabled = false;
    }
  }
  next.addEventListener("click", load);
  await load();
}

function walletId(create) {
  return locked(guestWalletKey, () => {
    let id = localStorage.getItem(guestWalletKey);
    if (!id && create) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(guestWalletKey, id);
    }
    return id;
  });
}

async function wallet() {
  open("Nạp tiền", '<div id="bank-transfer"><p role="status">Đang tải thông tin chuyển khoản…</p></div>');
  const panel = $("#bank-transfer");
  const memberId = member?.id;
  try {
    const { mountTopups } = await import("./topups.js");
    if (panel.isConnected && dialog.open) await mountTopups(panel, dialog, walletId, memberId);
  } catch (issue) {
    panel.textContent = issue.message;
  }
}

function historyContent() {
  const orders = state.orders.map((order) => '<li><div><strong>' + safe(order.name) + ' ×' + order.quantity + '</strong><small>' +
    safe(order.id) + ' · ' + dateTime.format(order.at) + ' · ' + currency(order.total) + '</small></div><span class="badge' +
    (finished(order) ? '' : ' pending') + '">' + (finished(order) ? "Xong" : "Đang chạy") + '</span></li>').join("");
  const guest = !member && state.profile ? '<p class="note">Hồ sơ thử ' + safe(state.profile) + '</p>' : '';
  return guest + '<div id="history-entries">' + button("Đơn đã mua", "purchases") + '<h3>Đơn mô phỏng</h3>' +
    (orders ? '<ul class="history-list">' + orders + '</ul>' : '<p>Chưa có đơn mô phỏng.</p>') + '</div>';
}

async function memberRequest(path, data) {
  const options = data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  };
  const response = await fetch("/api/member/" + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Không kết nối được tài khoản.");
  return result.member;
}

function setMember(person, broadcast = false) {
  const changed = member?.id !== person?.id;
  member = person;
  if (changed) {
    const suffix = person ? ":" + person.id : "";
    storageKey = guestStorageKey + suffix;
    state = readState() ?? initialState();
    if (!broadcast && dialog.open) dialog.close();
  }
  renderPage();
  if (broadcast) {
    try { localStorage.setItem(sessionNoticeKey, crypto.randomUUID()); } catch { /* The session cookie remains usable. */ }
  }
}

async function refreshMember() {
  const revision = ++authRevision;
  const person = await memberRequest("session");
  if (revision === authRevision) setMember(person);
}

function profile() {
  if (!member) return authForm(false);
  open("Hồ sơ của bạn", '<p class="note">Tên tài khoản <strong>' + safe(member.username) +
    '</strong></p><div class="inline-actions">' +
    button("Đơn đã mua", "purchases") + button("Lịch sử", "history", null, "outline") + button("Ví ngân hàng", "wallet", null, "outline") +
    button("Đăng xuất", "logout", null, "outline") + '</div>');
}

function authForm(registering, onAuthenticated = profile) {
  const label = registering ? "Đăng ký" : "Đăng nhập";
  const hint = registering ? '<p class="note">Tên tài khoản có 3–24 ký tự chữ, số hoặc dấu _. Mật khẩu có 8–128 ký tự.</p>' : '';
  open(label, '<form class="dialog-form" method="post">' + hint +
    '<label>Tên tài khoản<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required></label>' +
    '<label>Mật khẩu<input name="password" type="password" autocomplete="' + (registering ? 'new-password' : 'current-password') +
    '" minlength="8" maxlength="128" required></label>' +
    (registering ? '<label>Nhập lại mật khẩu<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>' : '') +
    '<div class="form-error" role="alert"></div><button class="btn primary" type="submit">' + label + '</button>' +
    '<button type="button" class="btn outline" data-auth-switch>' + (registering ? "Đã có tài khoản? Đăng nhập" : "Tạo tài khoản") + '</button></form>');
  const form = body.querySelector("form");
  form.querySelector("[data-auth-switch]").addEventListener("click", () => authForm(!registering, onAuthenticated));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".form-error");
    const submit = form.querySelector('button[type="submit"]');
    if (authBusy) {
      message.textContent = "Đang xử lý yêu cầu tài khoản. Vui lòng đợi.";
      return;
    }
    const password = form.elements.password.value;
    if (registering && password !== form.elements.confirmPassword.value) {
      message.textContent = "Hai ô mật khẩu chưa giống nhau.";
      return;
    }
    message.textContent = "";
    submit.disabled = true;
    authBusy = true;
    ++authRevision;
    try {
      const person = await memberRequest(registering ? "register" : "login", { username: form.elements.username.value, password });
      ++authRevision;
      form.reset();
      setMember(person, true);
      if (dialog.open) {
        if (form.isConnected) onAuthenticated();
        else dialog.close();
      }
      toast(registering ? "Đã tạo tài khoản." : "Đã đăng nhập.");
    } catch (issue) {
      message.textContent = issue.message;
    } finally {
      authBusy = false;
      submit.disabled = false;
    }
  });
}

async function logoutMember() {
  const control = body.querySelector('[data-action="logout"]');
  if (control) control.disabled = true;
  ++authRevision;
  try {
    const person = await memberRequest("logout", {});
    ++authRevision;
    setMember(person, true);
    if (dialog.open) dialog.close();
    toast("Đã đăng xuất.");
  } catch (issue) {
    toast(issue.message);
  } finally {
    if (control) control.disabled = false;
  }
}

async function support() {
  open("Hỗ trợ", '<p class="note">Xem cách tạo đơn và theo dõi chuyển khoản ngân hàng.</p><div class="inline-actions">' +
    '<a class="btn primary" href="#faq">Xem câu hỏi thường gặp</a>' + button("Xem lịch sử", "history", null, "outline") + '</div>');
  const links = body.querySelector(".inline-actions");
  try {
    const response = await fetch("/api/support");
    if (!response.ok) return;
    const { zaloUrl } = await response.json();
    if (!zaloUrl || !links.isConnected || !dialog.open) return;
    const chat = document.createElement("a");
    chat.className = "btn primary";
    chat.href = zaloUrl;
    chat.target = "_blank";
    chat.rel = "noopener noreferrer";
    chat.textContent = "Chat qua Zalo";
    links.querySelector("a").classList.replace("primary", "outline");
    links.prepend(chat);
  } catch {
    // Help links remain available if the contact cannot load.
  }
}

const actions = {
  order: (id) => orderForm(id),
  sale: (id) => {
    const sale = sales.find((item) => item.id === id);
    if (sale) orderForm(sale.packageId, sale);
  },
  product: productForm,
  purchases,
  receipt: viewPurchase,
  wallet,
  history: () => open("Lịch sử của bạn", historyContent(), "history"),
  profile,
  signup: () => member ? actions.history() : authForm(true),
  logout: logoutMember,
  flash: () => open("Flash Sale", '<div class="menu-list">' + sales.map(flashCard).join("") + '</div>'),
  support,
  menu: () => open("Tất cả mục", '<div class="menu-list">' + button("Hồ sơ", "profile", null, "outline") +
    button("Lịch sử", "history", null, "outline") + button("Flash Sale", "flash", null, "outline") +
    '<a class="btn outline" href="#bang-gia">Bảng giá</a><a class="btn outline" href="#faq">Câu hỏi thường gặp</a></div>'),
};

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  if (action) actions[action.dataset.action]?.(action.dataset.id);
  const filterButton = event.target.closest("[data-filter], [data-filter-link]");
  if (filterButton) {
    filter = filterButton.dataset.filter ?? filterButton.dataset.filterLink;
    renderCatalog();
    if (filterButton.dataset.filterLink) $("#bang-gia").scrollIntoView();
  }
  if (event.target.closest("dialog a[href^='#']")) dialog.close();
});
dialog.querySelector(".close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => {
  if (screen === "receipt") body.replaceChildren();
  screen = "";
});
renderPage();
refreshCatalog().catch(() => {});
refreshMember().catch(() => {});
window.addEventListener("storage", (event) => {
  if (event.key === sessionNoticeKey) {
    refreshMember().catch(() => {});
    return;
  }
  if (event.key !== storageKey) return;
  state = readState() ?? initialState();
  renderPage();
  if (dialog.open && screen === "history") body.innerHTML = historyContent();
});

setInterval(() => {
  if (!state.orders.length) return;
  renderRecent();
  if (screen === "history" && dialog.open) {
    const entries = $("#history-entries");
    const orders = entries.querySelectorAll("li .badge");
    state.orders.forEach((order, index) => {
      if (finished(order) && orders[index].classList.contains("pending")) {
        orders[index].classList.remove("pending");
        orders[index].textContent = "Xong";
      }
    });
  }
}, 1000);
