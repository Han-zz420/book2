// booklist.json → 正式页 index.html + 校对页 proof.html
// 用法：
//   1) 校对：用浏览器打开 proof.html，逐组去重/改名后“导出 booklist.json”并覆盖到本目录
//   2) 运行：node build-page.cjs
const fs = require("node:fs");
const path = require("node:path");

const DIR = __dirname;
const list = JSON.parse(fs.readFileSync(path.join(DIR, "booklist.json"), "utf8"));

// 在 <script> 内嵌入 JSON 时把 </ 转义成 <\/ ，防止内容中出现 </script> 提前闭合
const safeJson = (v) => JSON.stringify(v).replace(/<\//g, "<\\/");

// ---- 正式页 ----
// price/stock：取 booklist 每行字段；缺省时兜底为占位 9.9 / 1（可随时改下面常量后重跑）
const DEF_PRICE = 9.9;
const DEF_STOCK = 1;
const books = list.map((b) => ({
  id: b.id,
  title: (b.title || "").trim(),
  author: (b.author || "").trim(),
  cover: b.cover || "",
  price: Number.isFinite(+b.price) && +b.price >= 0 ? Math.round(+b.price * 100) / 100 : DEF_PRICE,
  stock: Number.isInteger(+b.stock) && +b.stock >= 0 ? +b.stock : DEF_STOCK,
  category: (b.category || "").trim(),
}));
const tpl = fs.readFileSync(path.join(DIR, "index.template.html"), "utf8");
if (!tpl.includes("__BOOKS_DATA__")) throw new Error("index 模板缺少 __BOOKS_DATA__");
fs.writeFileSync(path.join(DIR, "index.html"), tpl.replace("__BOOKS_DATA__", safeJson(books)), "utf8");

// ---- 校对页（含 file/ocr，供 OCR 候选填充与分组比对）----
const ptpl = fs.readFileSync(path.join(DIR, "proof.template.html"), "utf8");
if (!ptpl.includes("__PROOF_DATA__")) throw new Error("proof 模板缺少 __PROOF_DATA__");
fs.writeFileSync(path.join(DIR, "proof.html"), ptpl.replace("__PROOF_DATA__", safeJson(list)), "utf8");

const empty = books.filter((b) => !b.title).length;
console.log(`已生成：index.html ${books.length} 条（书名待补 ${empty}）；proof.html ${list.length} 条`);
