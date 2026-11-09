import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { defaultPriceEntries } from "../public/catalog-data.js";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function assets(directory, prefix = "") {
  const output = {};
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, file.name);
    const key = prefix + "/" + file.name;
    if (file.isDirectory()) {
      Object.assign(output, await assets(filename, key));
    } else {
      const type = types[extname(file.name)];
      if (!type) throw new Error("Unsupported site asset: " + filename);
      output[key] = { type, base64: (await readFile(filename)).toString("base64") };
    }
  }
  return output;
}

const files = await assets("public");
files["/qr-library.js"] = {
  type: types[".js"],
  base64: (await readFile(new URL(import.meta.resolve("qrcode-generator")))).toString("base64"),
};
const banks = JSON.parse(await readFile("public/banks.json", "utf8"));
const source = await readFile("worker/index.js", "utf8");
const payments = await readFile("worker/payments.js", "utf8");
const prices = await readFile("worker/prices.js", "utf8");
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
await writeFile("dist/server/index.js",
  "const FILES = " + JSON.stringify(files) + ";\nconst BANKS = " + JSON.stringify(banks) +
  ";\nconst PRICE_DEFAULTS = " + JSON.stringify(defaultPriceEntries) + ";\n" + prices + "\n" + payments + "\n" + source);
