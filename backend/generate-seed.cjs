// 从 ../booklist.json 生成 backend/seed.sql（书籍种子数据）
// 用法：node generate-seed.cjs
const fs = require("node:fs");
const path = require("node:path");

const list = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "booklist.json"), "utf8")
);

const esc = (s) => String(s ?? "").replace(/'/g, "''");

const lines = [];
lines.push("-- 由 booklist.json 自动生成，请勿手改（改后重跑 node generate-seed.cjs）");
lines.push("-- 幂等：先清空再插入，保证与 booklist.json 一致");
lines.push("DELETE FROM books;");
lines.push("");
for (const b of list) {
  const id = Number(b.id);
  const title = esc(b.title || "");
  const author = esc(b.author || "");
  const cover = esc(b.cover || "");
  const price = Number.isFinite(+b.price) && +b.price >= 0 ? +b.price : 9.9;
  const stock = Number.isInteger(+b.stock) && +b.stock >= 0 ? +b.stock : 0;
  const category = esc(b.category || "");
  lines.push(
    `INSERT INTO books (id, title, author, cover, price, stock, category) VALUES (${id}, '${title}', '${author}', '${cover}', ${price}, ${stock}, '${category}');`
  );
}
lines.push("");

fs.writeFileSync(
  path.join(__dirname, "seed.sql"),
  lines.join("\n"),
  "utf8"
);
console.log(`已生成 seed.sql，共 ${list.length} 条书籍记录。`);
