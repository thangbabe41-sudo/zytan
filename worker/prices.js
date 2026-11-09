const defaultPricesById = new Map(PRICE_DEFAULTS.map((item) => [item.id, item]));

async function priceOverrides(db) {
  const { results } = await db.prepare("SELECT product_id, amounts FROM catalog_prices").all();
  return Object.fromEntries(results.map((row) => [row.product_id, JSON.parse(row.amounts)]));
}

async function priceEditor(db) {
  const [overrides, custom] = await Promise.all([
    priceOverrides(db),
    db.prepare("SELECT id, name, price FROM catalog_accounts ORDER BY updated_at DESC").all(),
  ]);
  return PRICE_DEFAULTS.map((item) => ({ ...item, amounts: overrides[item.id] ?? item.amounts })).concat(
    custom.results.map((item) => ({
      id: "acc-" + item.id, name: item.name, group: "Acc bạn thêm", labels: ["Giá (Xu/acc)"], amounts: [item.price],
    }))
  );
}

async function savePrice(db, data) {
  const { id, amounts } = data;
  const item = defaultPricesById.get(id);
  const custom = typeof id === "string" && id.startsWith("acc-") && idPattern.test(id.slice(4));
  if (!item && !custom) return error("Không tìm thấy sản phẩm.", 404);
  if (!Array.isArray(amounts) || amounts.length !== (item?.amounts.length ?? 1) ||
      !amounts.every((value) => inRange(value, 1, 100000000))) {
    return error("Nhập giá Xu nguyên từ 1 đến 100.000.000.", 400);
  }
  if (item?.group === "Flash Sale" && amounts[0] > amounts[1]) {
    return error("Giá ưu đãi không được cao hơn giá gốc.", 400);
  }
  if (custom) {
    const saved = await db.prepare("UPDATE catalog_accounts SET price=? WHERE id=? RETURNING id")
      .bind(amounts[0], id.slice(4)).first();
    if (!saved) return error("Không tìm thấy sản phẩm.", 404);
  } else {
    await db.prepare("INSERT INTO catalog_prices(product_id, amounts) VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET amounts=excluded.amounts")
      .bind(id, JSON.stringify(amounts)).run();
  }
  return json({ id, amounts });
}
