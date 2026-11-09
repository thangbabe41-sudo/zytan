"use strict";

const $ = (selector) => document.querySelector(selector);
const productForm = $("#product-form");
const stockForm = $("#stock-form");
const stockProduct = stockForm.elements.productId;
const stockMore = $("#stock-more");
const stockBatchSize = 16;
const stockLineLength = 4096;
const paymentForm = $("#payment-form");
const supportForm = $("#support-form");
const priceForm = $("#price-form");
const priceProduct = $("#price-product");
const priceItems = new Map();
const money = (value) => new Intl.NumberFormat("vi-VN").format(value) + " Xu";
let editing;

async function api(path, data) {
  const options = data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  };
  const response = await fetch("/api/admin/" + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Yêu cầu chưa hoàn tất.");
  return result;
}

function listItem(title, caption, label, callback) {
  const item = document.createElement("li");
  const text = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const detail = document.createElement("small");
  detail.textContent = caption;
  text.append(strong, detail);
  item.append(text);
  if (label) {
    const button = document.createElement("button");
    button.className = "btn outline compact";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => callback(button));
    item.append(button);
  }
  return item;
}

function edit(item) {
  editing = item.id;
  const fields = productForm.elements;
  fields.name.value = item.name;
  fields.kind.value = item.kind;
  fields.price.value = item.price;
  fields.stock.value = item.stock;
  fields.photo.value = item.photo;
  fields.active.checked = Boolean(item.active);
  updateStockField();
  $("#product-title").textContent = "Sửa mặt hàng";
  $("#cancel-edit").hidden = false;
  fields.name.focus();
}

function resetProduct() {
  editing = undefined;
  productForm.reset();
  updateStockField();
  $("#product-title").textContent = "Thêm mặt hàng";
  $("#cancel-edit").hidden = true;
}

async function renderProducts() {
  const { accounts } = await api("catalog");
  $("#product-list").replaceChildren(...accounts.map((item) => listItem(item.name,
    (item.kind === "other" ? "Hàng khác" : "Acc") + " · " + money(item.price) +
    " · Số lượng " + item.stock + " · " + (item.active ? "Đang hiện" : "Đã ẩn"),
    "Sửa", () => edit(item))));
  const selected = stockProduct.value;
  const items = accounts.filter((item) => item.kind === "account");
  stockProduct.replaceChildren(new Option("Chọn mặt hàng Acc", ""), ...items.map((item) =>
    new Option(item.name + (item.active ? "" : " (đang ẩn)"), item.id)));
  stockProduct.value = items.some((item) => item.id === selected) ? selected : "";
  stockProduct.disabled = false;
  await renderStock();
}

function updateStockField() {
  const fields = productForm.elements;
  fields.stock.disabled = fields.kind.value === "account";
  $("#stock-hint").hidden = !fields.stock.disabled;
}

async function renderStock(offset = 0) {
  const productId = stockProduct.value;
  const list = $("#stock-list");
  stockForm.querySelector('button[type="submit"]').disabled = !productId;
  if (!offset) {
    list.replaceChildren();
    stockMore.hidden = true;
  }
  if (!productId) return;
  const { items, nextOffset } = await api("stock?product=" + encodeURIComponent(productId) + "&offset=" + offset);
  if (productId !== stockProduct.value) return;
  list.append(...items.map((item) => listItem("Acc " + item.id.slice(-8),
    item.sold ? "Đã giao" : "Chưa bán", item.sold ? null : "Gỡ", async (button) => {
      if (!window.confirm("Gỡ acc chưa bán này khỏi kho?")) return;
      button.disabled = true;
      try {
        await api("stock/remove", { id: item.id });
        $("#stock-status").textContent = "Đã gỡ acc khỏi kho.";
        await renderProducts();
      } catch (issue) {
        $("#stock-status").textContent = issue.message;
        button.disabled = false;
      }
    })));
  if (!offset && !items.length) list.append(listItem("Kho trống", "Nhập file acc để khách có thể mua mặt hàng này."));
  stockMore.hidden = nextOffset == null;
  stockMore.dataset.offset = nextOffset ?? "";
}

function stockFileRow(value, line) {
  if (value.length > stockLineLength) throw new Error("Dòng " + line + " quá dài.");
  if (!value.trim()) return null;
  const fields = value.split("|").map((field, column) => column % 2 ? field : field.trim());
  if (fields.length !== 4 || /[\x00-\x1f\x7f]/.test(value) ||
      fields.some((field, column) => !field || field.length > (column % 2 ? 256 : 180))) {
    throw new Error("Dòng " + line + " cần đủ 4 cột theo định dạng TK|MK|TKM|MKM.");
  }
  return { line, text: fields.join("|") };
}

async function* stockFileRows(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let partial = "";
  let line = 0;
  let endedWithCR = false;
  try {
    for (;;) {
      let chunk, text;
      try {
        chunk = await reader.read();
        text = decoder.decode(chunk.value, { stream: !chunk.done });
      } catch {
        throw new Error("Không đọc được file. Kiểm tra file .txt dùng định dạng UTF-8.");
      }
      if (text) {
        // A CRLF line break can be split between two stream chunks.
        if (endedWithCR && text.startsWith("\n")) text = text.slice(1);
        endedWithCR = text.endsWith("\r");
        const lines = (partial + text).split(/\r\n|\r|\n/);
        partial = lines.pop();
        for (const value of lines) {
          const row = stockFileRow(value, ++line);
          if (row) yield row;
        }
        if (partial.length > stockLineLength) throw new Error("Dòng " + (line + 1) + " quá dài.");
      }
      if (chunk.done) break;
    }
    const row = stockFileRow(partial, line + 1);
    if (row) yield row;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function submit(event, status, mutation, refresh) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    status.textContent = "";
    status.textContent = await mutation();
    try { await refresh?.(); } catch { status.textContent += " Tải lại trang để cập nhật danh sách."; }
  } catch (issue) {
    status.textContent = issue.message;
  } finally {
    button.disabled = false;
  }
}

function showPriceFields() {
  const item = priceItems.get(priceProduct.value);
  const fields = item ? item.labels.map((text, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "100000000";
    input.step = "1";
    input.required = true;
    input.value = item.amounts[index];
    label.append(text, input);
    return label;
  }) : [];
  $("#price-fields").replaceChildren(...fields);
  priceForm.querySelector('button[type="submit"]').disabled = !item;
}

async function loadPrices() {
  const selected = priceProduct.value;
  const { items } = await api("prices");
  const groups = new Map();
  priceItems.clear();
  for (const item of items) {
    if (!groups.has(item.group)) {
      const group = document.createElement("optgroup");
      group.label = item.group;
      groups.set(item.group, group);
    }
    groups.get(item.group).append(new Option(item.name, item.id));
    priceItems.set(item.id, item);
  }
  priceProduct.replaceChildren(new Option("Chọn sản phẩm", ""), ...groups.values());
  priceProduct.value = priceItems.has(selected) ? selected : "";
  priceProduct.disabled = false;
  showPriceFields();
}

priceProduct.addEventListener("change", () => {
  $("#price-status").textContent = "";
  showPriceFields();
});

priceForm.addEventListener("submit", (event) => submit(event, $("#price-status"), async () => {
  const item = priceItems.get(priceProduct.value);
  const amounts = Array.from($("#price-fields").querySelectorAll("input"), (input) => input.valueAsNumber);
  priceProduct.disabled = true;
  try {
    const result = await api("prices", { id: item.id, amounts });
    item.amounts = result.amounts;
    return "Đã lưu giá cho " + item.name + ".";
  } finally {
    priceProduct.disabled = false;
  }
}, renderProducts));

productForm.addEventListener("submit", (event) => submit(event, $("#product-status"), async () => {
  const fields = productForm.elements;
  await api("catalog", {
    id: editing, name: fields.name.value, kind: fields.kind.value, price: fields.price.valueAsNumber,
    stock: fields.kind.value === "account" ? 0 : fields.stock.valueAsNumber, photo: fields.photo.value, active: fields.active.checked,
  });
  resetProduct();
  return "Đã lưu mặt hàng.";
}, () => Promise.all([renderProducts(), loadPrices()])));

$("#cancel-edit").addEventListener("click", resetProduct);
productForm.elements.kind.addEventListener("change", updateStockField);
stockProduct.addEventListener("change", () => {
  $("#stock-status").textContent = "";
  renderStock().catch((issue) => { $("#stock-status").textContent = issue.message; });
});

stockMore.addEventListener("click", async () => {
  stockMore.disabled = true;
  try {
    await renderStock(Number(stockMore.dataset.offset));
  } catch (issue) {
    $("#stock-status").textContent = issue.message;
  } finally {
    stockMore.disabled = false;
  }
});

stockForm.addEventListener("submit", (event) => submit(event, $("#stock-status"), async () => {
  const input = stockForm.elements.stockFile;
  const productId = stockProduct.value;
  const status = $("#stock-status");
  stockProduct.disabled = true;
  input.disabled = true;
  try {
    const file = input.files[0];
    if (!file?.name.toLowerCase().endsWith(".txt")) throw new Error("Chọn file có đuôi .txt.");
    status.textContent = "Đang kiểm tra định dạng file…";
    let total = 0;
    for await (const row of stockFileRows(file)) {
      total++;
      if (total % 1000 === 0) status.textContent = "Đã kiểm tra " + total + " dòng acc…";
    }
    if (!total) throw new Error("File chưa có dòng acc nào.");
    let processed = 0;
    let added = 0;
    let duplicates = 0;
    const sampleDuplicates = [];
    let batch = [];
    async function sendBatch() {
      status.textContent = "Đang nhập " + processed + "/" + total + " acc…";
      const result = await api("stock/import", { productId, rows: batch });
      processed += batch.length;
      added += result.added;
      duplicates += result.duplicates.length;
      sampleDuplicates.push(...result.duplicates.slice(0, 20 - sampleDuplicates.length));
      batch = [];
    }
    try {
      for await (const row of stockFileRows(file)) {
        batch.push(row);
        if (batch.length === stockBatchSize) await sendBatch();
      }
      if (batch.length) await sendBatch();
    } catch (issue) {
      await renderProducts().catch(() => {});
      throw new Error("Đã xác nhận thêm " + added + " acc. " + issue.message +
        " Bạn có thể nhập lại cùng file, các dòng đã lưu sẽ được bỏ qua.");
    }
    input.value = "";
    const remainingDuplicates = duplicates - sampleDuplicates.length;
    const duplicateSummary = duplicates ? " Bỏ qua " + duplicates + " dòng trùng tài khoản game hoặc mail (dòng " +
      sampleDuplicates.join(", ") + (remainingDuplicates ? " và " + remainingDuplicates + " dòng khác" : "") + ")." : "";
    return "Đã thêm " + added + " acc." + duplicateSummary;
  } finally {
    stockProduct.disabled = false;
    input.disabled = false;
  }
}, renderProducts));

async function loadSupportContact() {
  const { zaloUrl } = await api("support");
  const field = supportForm.elements.zalo;
  field.value = zaloUrl;
  field.disabled = false;
  supportForm.querySelector('button[type="submit"]').disabled = false;
}

supportForm.addEventListener("submit", (event) => submit(event, $("#support-status"), async () => {
  const field = supportForm.elements.zalo;
  const { zaloUrl } = await api("support", { zalo: field.value });
  field.value = zaloUrl;
  return zaloUrl ? "Đã lưu. Khách có thể chọn Chat qua Zalo trong mục Hỗ trợ." : "Đã ẩn nút Chat qua Zalo.";
}));

function receiverFromForm() {
  const fields = paymentForm.elements;
  return {
    bin: fields.bin.value, bank: fields.bin.selectedOptions[0].textContent,
    account: fields.account.value.trim(), holder: fields.holder.value.trim(),
    enabled: fields.enabled.checked,
  };
}

function connectionMessage(settings) {
  if (!settings?.hasSecret) return "Chưa lưu Secret Key của SePay.";
  if (!settings.verifiedAt) return "Đã lưu Secret Key. Đang chờ thông báo tiền vào hợp lệ từ SePay.";
  return settings.enabled ? "Đã kết nối SePay. Khách có thể tạo QR và nhận mã tự động." : "Đã kết nối SePay. QR đang ẩn với khách.";
}

$("#sepay-url").value = new URL("/api/webhooks/sepay", location.origin).href;
$("#sepay-url").addEventListener("click", (event) => event.currentTarget.select());
$("#copy-sepay-url").addEventListener("click", async () => {
  const input = $("#sepay-url");
  try {
    await navigator.clipboard.writeText(input.value);
    $("#sepay-copy-status").textContent = "Đã sao chép URL.";
  } catch {
    input.select();
    $("#sepay-copy-status").textContent = "URL đã được chọn để bạn sao chép.";
  }
});

async function loadPaymentSettings() {
  const [banksResponse, result] = await Promise.all([fetch("/banks.json"), api("payment")]);
  if (!banksResponse.ok) throw new Error("Không tải được danh sách ngân hàng.");
  const banks = await banksResponse.json();
  const fields = paymentForm.elements;
  Object.entries(banks).sort((a, b) => a[1].localeCompare(b[1], "vi")).forEach(([bin, name]) => {
    fields.bin.add(new Option(name, bin));
  });
  if (result.settings) {
    fields.bin.value = result.settings.bin;
    fields.account.value = result.settings.account;
    fields.holder.value = result.settings.holder;
    fields.enabled.checked = result.settings.enabled;
  }
  paymentForm.querySelector('button[type="submit"]').disabled = false;
  $("#preview-payment").disabled = false;
  $("#payment-status").textContent = connectionMessage(result.settings);
}

paymentForm.addEventListener("submit", (event) => submit(event, $("#payment-status"), async () => {
  const receiver = receiverFromForm();
  const fields = paymentForm.elements;
  const result = await api("payment", { ...receiver, secret: fields.secret.value.trim() });
  fields.secret.value = "";
  return "Đã lưu. " + connectionMessage(result.settings);
}));

$("#check-payment").addEventListener("click", async () => {
  try {
    $("#payment-status").textContent = connectionMessage((await api("payment")).settings);
  } catch (issue) {
    $("#payment-status").textContent = issue.message;
  }
});
paymentForm.addEventListener("input", () => { $("#payment-preview").hidden = true; });
$("#preview-payment").addEventListener("click", async () => {
  if (!paymentForm.reportValidity()) return;
  try {
    const { displayQr } = await import("./vietqr.js");
    displayQr($("#payment-preview"), receiverFromForm(), 10000, "ZIKOXEMTRUOC");
    $("#payment-status").textContent = "QR xem trước 10.000 ₫. Kiểm tra ngân hàng và tên người nhận trên app trước khi bật.";
  } catch (issue) {
    $("#payment-status").textContent = issue.message;
  }
});

loadPaymentSettings().catch((issue) => { $("#payment-status").textContent = issue.message; });
loadSupportContact().catch((issue) => { $("#support-status").textContent = issue.message; });
loadPrices().catch((issue) => { $("#price-status").textContent = issue.message; });
renderProducts().catch((issue) => { $("#product-status").textContent = issue.message; });
