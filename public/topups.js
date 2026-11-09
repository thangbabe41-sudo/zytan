import { minAmount, maxAmount, vnd, displayQr } from "./vietqr.js";

async function payment(path, data) {
  const options = data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  };
  const response = await fetch("/api/payment" + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Không kiểm tra được giao dịch. Vui lòng thử lại.");
  return result;
}

function control(label, action, style = "outline") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn compact " + style;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

export async function mountTopups(panel, dialog, walletId) {
  panel.innerHTML = '<p class="note">Tiền nạp qua ngân hàng được ghi nhận riêng. Đơn mua acc và đặt rương hiện dùng Xu thử.</p>' +
    '<div class="topup-section"><div class="bank-start" aria-live="polite">Đang tải phương thức nạp…</div>' +
    '<div class="bank-result" hidden></div><div class="bank-message" role="status"></div>' +
    '<strong class="bank-balance">Số dư nạp ngân hàng: 0 ₫</strong><h3>Giao dịch gần đây</h3><ul class="history-list"></ul>' +
    '<details><summary>Dùng mã nạp ngân hàng</summary><form class="dialog-form">' +
    '<label>Mã nạp <input name="code" placeholder="ZK-…" maxlength="35" autocomplete="off" required></label>' +
    '<button type="submit" class="btn primary">Dùng mã</button></form></details></div>';

  const start = panel.querySelector(".bank-start");
  const qr = panel.querySelector(".bank-result");
  const message = panel.querySelector(".bank-message");
  const list = panel.querySelector(".history-list");
  const active = () => panel.isConnected && dialog.open;
  let wallet = await walletId(false);
  let selected;
  let previous = "";
  let polling = false;
  let deadline = Date.now() + 300000;

  async function useCode(code) {
    wallet = await walletId(true);
    const result = await payment("/redeem", { wallet, code });
    message.textContent = "Đã ghi nhận mã nạp " + vnd(result.amount) + ".";
    await refresh();
  }

  function showQr(topup) {
    selected = topup.reference;
    displayQr(qr, topup.receiver, topup.amount, topup.reference);
    message.textContent = "Đang chờ ngân hàng xác nhận. Mã nạp sẽ tự hiện tại đây.";
    deadline = Date.now() + 300000;
    poll();
  }

  function render({ topups, balance }) {
    panel.querySelector(".bank-balance").textContent = "Số dư nạp ngân hàng: " + vnd(balance);
    const updated = JSON.stringify(topups);
    if (updated === previous) return;
    previous = updated;
    list.replaceChildren(...topups.map((topup) => {
      const item = document.createElement("li");
      const content = document.createElement("div");
      content.className = "topup-code";
      const title = document.createElement("strong");
      title.textContent = vnd(topup.amount) + " · " + topup.reference;
      const status = document.createElement("small");
      status.textContent = { pending: "Chờ xác nhận", paid: "Đã nhận tiền · Mã nạp của bạn", redeemed: "Đã dùng mã", expired: "QR đã hết hạn" }[topup.status];
      content.append(title, status);
      item.append(content);
      if (topup.status === "pending") item.append(control("Xem QR", () => showQr(topup)));
      if (topup.status === "paid") {
        const code = document.createElement("input");
        code.readOnly = true;
        code.value = topup.code;
        code.setAttribute("aria-label", "Mã nạp " + topup.reference);
        const copy = control("Sao chép", async () => {
          try {
            await navigator.clipboard.writeText(topup.code);
            message.textContent = "Đã sao chép mã nạp.";
          } catch { code.select(); }
        });
        content.append(code, copy, control("Dùng mã ngay", async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try { await useCode(topup.code); } catch (issue) { message.textContent = issue.message; }
          finally { button.disabled = false; }
        }, "primary"));
      }
      if (topup.reference === selected && topup.status !== "pending") {
        qr.hidden = true;
        selected = undefined;
        message.textContent = {
          paid: "Ngân hàng đã xác nhận. Mã nạp đã hiện bên dưới.",
          redeemed: "Mã nạp đã được dùng.", expired: "QR đã hết hạn. Bạn có thể tạo mã mới.",
        }[topup.status];
      }
      return item;
    }));
    if (!topups.length) {
      const empty = document.createElement("li");
      empty.textContent = "Chưa có giao dịch.";
      list.append(empty);
    }
  }

  async function refresh() {
    const result = wallet ? await payment("/status", { wallet }) : { topups: [], balance: 0 };
    if (active()) render(result);
    return result.topups.some((topup) => topup.status === "pending");
  }

  function poll() {
    if (polling) return;
    polling = true;
    const tick = async () => {
      if (!active() || Date.now() > deadline) { polling = false; return; }
      try {
        if (!(await refresh())) { polling = false; return; }
      } catch {
        // Keep checking until the deadline if the network drops briefly.
      }
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 3500);
  }

  const actions = panel.querySelector(".topup-section");
  actions.append(control("Kiểm tra lại giao dịch", () => {
    deadline = Date.now() + 300000;
    refresh().then((pending) => { if (pending) poll(); }).catch((issue) => { message.textContent = issue.message; });
  }));

  const redeem = panel.querySelector("details form");
  redeem.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = redeem.querySelector("button");
    submit.disabled = true;
    try { await useCode(redeem.elements.code.value); redeem.reset(); }
    catch (issue) { message.textContent = issue.message; }
    finally { submit.disabled = false; }
  });

  refresh().then((pending) => { if (pending) poll(); }).catch((issue) => { message.textContent = issue.message; });
  try {
    const result = await payment("");
    if (!active()) return;
    if (!result.payment) {
      start.textContent = "Nạp tiền tự động sẽ mở khi Ziko kết nối ngân hàng.";
      return;
    }
    start.innerHTML = '<form class="dialog-form"><label>Số tiền muốn nạp (₫)' +
      '<input name="amount" type="number" min="' + minAmount + '" max="' + maxAmount + '" step="1" placeholder="Ví dụ 50000" required></label>' +
      '<button type="submit" class="btn primary">Tạo mã QR</button><p>Giữ nguyên số tiền và nội dung khi quét. Bạn có thể mở lại Nạp tiền trên trình duyệt này để xem mã.</p></form>';
    const form = start.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button");
      submit.disabled = true;
      try {
        wallet = await walletId(true);
        const { topup } = await payment("/start", { wallet, amount: form.elements.amount.valueAsNumber });
        if (!active()) return;
        showQr(topup);
        await refresh();
      } catch (issue) { message.textContent = issue.message; }
      finally { submit.disabled = false; }
    });
  } catch (issue) { start.textContent = issue.message; }
}
