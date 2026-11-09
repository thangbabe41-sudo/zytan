import qrCode from "./qr-library.js";

export const minAmount = 1;
export const maxAmount = 499999999;
export const vnd = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const tlv = (tag, value) => tag + String(value.length).padStart(2, "0") + value;

function checksum(value) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc.toString(16).padStart(4, "0").toUpperCase();
}

export function payload({ bin, account, amount, reference }) {
  if (!/^\d{6}$/.test(bin) || !/^[A-Za-z0-9]{1,19}$/.test(account) ||
      !Number.isSafeInteger(amount) || amount < minAmount || amount > maxAmount ||
      !/^[A-Z0-9]{1,25}$/.test(reference)) throw new Error("Kiểm tra lại thông tin tạo QR.");
  const accountInfo = tlv("00", bin) + tlv("01", account);
  const recipient = tlv("00", "A000000727") + tlv("01", accountInfo) + tlv("02", "QRIBFTTA");
  const message = tlv("00", "01") + tlv("01", "12") + tlv("38", recipient) +
    tlv("53", "704") + tlv("54", String(amount)) + tlv("58", "VN") + tlv("62", tlv("08", reference)) + "6304";
  return message + checksum(message);
}

export function qrSvg(value) {
  const qr = qrCode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

export function displayQr(element, receiver, amount, memo) {
  const frame = document.createElement("div");
  frame.className = "bank-qr";
  frame.setAttribute("role", "img");
  frame.setAttribute("aria-label", "Mã VietQR chuyển khoản " + vnd(amount));
  frame.innerHTML = qrSvg(payload({ ...receiver, amount, reference: memo }));

  const details = document.createElement("dl");
  details.className = "bank-details";
  for (const [label, value] of [
    ["Ngân hàng", receiver.bank], ["Số tài khoản", receiver.account], ["Chủ tài khoản", receiver.holder],
    ["Số tiền", vnd(amount)], ["Nội dung", memo],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const info = document.createElement("dd");
    info.textContent = value;
    details.append(term, info);
  }
  element.replaceChildren(frame, details);
  element.hidden = false;
}
