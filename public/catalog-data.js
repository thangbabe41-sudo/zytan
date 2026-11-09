export const packages = [
  { id: "ss", name: "1 Rương SS", prices: [1500, 1500, 1000], detail: "Gói 1 rương SS theo mã sự kiện." },
  { id: "duo", name: "2 Rương SS + S+", prices: [1500, 1500, 1500], detail: "Gói 2 rương SS và S+ theo mã sự kiện." },
  { id: "full", name: "Full 3 Rương", prices: [3000, 1500, 1000], detail: "Gói đủ 3 rương Chung Sức." },
];
export const sales = [
  { id: "flash-full", packageId: "full", price: 1500, oldPrice: 9000, stock: 0 },
  { id: "flash-ss", packageId: "ss", price: 500, oldPrice: 4000, stock: 0 },
];
export const sampleAccounts = [
  { id: "clone", name: "Acc Clone (MXT) 400 Quân Huy hữu hạn", price: 1500, photo: "brand.svg", featured: true },
  { id: "paper", name: "Giấy Tuyệt Sắc MXT", price: 1000, photo: "giay-tuyet-sac.webp", featured: true },
  { id: "nak", name: "ACC REG NAK LÔI MXT", price: 10000, photo: "nak-loi.webp", featured: true },
  { id: "ryoma", name: "RYOMA SAMURAI MXT", price: 7000, photo: "ryoma.webp" },
  { id: "veres", name: "Veres Kimono MXT", price: 7000, photo: "veres.webp" },
  { id: "combo", name: "Rương Combo Nak", price: 45000, photo: "combo-nak.webp" },
  { id: "van", name: "Triệu Vân Kỵ Sĩ Tận Thế MXT", price: 7000, photo: "trieu-van.webp" },
  { id: "liliana", name: "REG MXT Liliana Lưu Thủy Thần Long", price: 7000, photo: "liliana.webp" },
];
export const roles = ["Thành viên", "CTV", "Seller"];

export const defaultPriceEntries = [
  ...packages.map((item) => ({
    id: item.id, name: item.name, group: "Gói rương",
    labels: roles.map((role) => "Giá " + role + " (Xu/mã)"), amounts: item.prices,
  })),
  ...sales.map((item) => ({
    id: item.id, name: packages.find((product) => product.id === item.packageId).name, group: "Flash Sale",
    labels: ["Giá ưu đãi (Xu/mã)", "Giá gốc (Xu/mã)"], amounts: [item.price, item.oldPrice],
  })),
];
