"use strict";

const $ = (selector) => document.querySelector(selector);
const productForm = $("#product-form");
const codeForm = $("#code-form");
const paymentForm = $("#payment-form");
const priceForm = $("#price-form");
const priceProduct = $("#price-product");
const priceItems = new Map();
const money = (value) => new Intl.NumberFormat("vi-VN").format(value) + " Xu";
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
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
  fields.price.value = item.price;
  fields.stock.value = item.stock;
  fields.photo.value = item.photo;
  fields.active.checked = Boolean(item.active);
  $("#product-title").textContent = "Sửa mẫu acc";
  $("#cancel-edit").hidden = false;
  fields.name.focus();
}

function resetProduct() {
  editing = undefined;
  productForm.reset();
  $("#product-title").textContent = "Thêm mẫu acc";
  $("#cancel-edit").hidden = true;
}

async function renderProducts() {
  const { accounts } = await api("catalog");
  $("#product-list").replaceChildren(...accounts.map((item) => listItem(item.name,
    money(item.price) + " · " + item.stock + " acc · " + (item.active ? "Đang hiện" : "Đã ẩn"),
    "Sửa", () => edit(item))));
  if (!accounts.length) $("#product-list").append(listItem("Chưa có mẫu acc bạn thêm", "Các sản phẩm minh họa có sẵn vẫn ở trang chủ."));
}

async function renderCodes() {
  const { codes } = await api("codes");
  $("#code-list").replaceChildren(...codes.map((item) => {
    const status = item.redeemed_at ? "Đã dùng" : item.revoked_at ? "Đã hủy" : "Chưa dùng";
    return listItem("••••" + item.suffix + " · " + money(item.amount),
      status + " · " + dates.format(item.created_at),
      status === "Chưa dùng" ? "Hủy mã" : "", async (button) => {
        button.disabled = true;
        try {
          await api("codes/revoke", { id: item.id });
          $("#code-status").textContent = "Đã hủy mã.";
          await renderCodes();
        } catch (issue) {
          $("#code-status").textContent = issue.message;
        } finally {
          button.disabled = false;
        }
      });
  }));
  if (!codes.length) $("#code-list").append(listItem("Chưa có mã nạp", "Tạo một mã để gửi cho khách."));
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
    id: editing, name: fields.name.value, price: fields.price.valueAsNumber,
    stock: fields.stock.valueAsNumber, photo: fields.photo.value, active: fields.active.checked,
  });
  resetProduct();
  return "Đã lưu mẫu acc.";
}, () => Promise.all([renderProducts(), loadPrices()])));

codeForm.addEventListener("submit", (event) => submit(event, $("#code-status"), async () => {
  const { code, amount } = await api("codes", { amount: codeForm.elements.amount.valueAsNumber });
  $("#created-code").value = code;
  $("#new-code").hidden = false;
  return "Đã tạo mã nạp " + money(amount) + " thử.";
}, renderCodes));

$("#cancel-edit").addEventListener("click", resetProduct);
$("#copy-code").addEventListener("click", async () => {
  const input = $("#created-code");
  try {
    await navigator.clipboard.writeText(input.value);
    $("#code-status").textContent = "Đã sao chép mã nạp.";
  } catch {
    input.select();
    $("#code-status").textContent = "Mã đã được chọn để bạn sao chép.";
  }
});

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
loadPrices().catch((issue) => { $("#price-status").textContent = issue.message; });
renderProducts().catch((issue) => { $("#product-status").textContent = issue.message; });
renderCodes().catch((issue) => { $("#code-status").textContent = issue.message; });
