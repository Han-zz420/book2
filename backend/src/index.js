// ============================================================
// 二手书平台后端 API（Cloudflare Workers + D1）
//   GET  /api/books          → 返回全部书籍（含实时库存）
//   GET  /api/books/:id      → 返回单本书实时库存
//   POST /api/order          → 下单：事务内原子扣库存 + 写订单
//   GET  /api/health         → 健康检查
//
// 并发一致性说明：
//   D1 底层是 SQLite，单写者模型 + env.DB.batch() 是一个原子事务。
//   扣库存用  UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?
//   —— WHERE stock >= qty 保证「库存不足时该行不受影响(changes=0)」，
//   从根上杜绝并发超卖。任一语句 changes=0 则整个 batch 回滚。
// ============================================================

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function genOrderNo() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SX${ts}${rnd}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, time: new Date().toISOString() });
    }

    // ---- 书籍列表（含实时库存） ----
    if (request.method === "GET" && path === "/api/books") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, title, author, cover, price, stock, category FROM books ORDER BY id ASC"
        ).all();
        return json({ ok: true, books: results });
      } catch (e) {
        return json({ ok: false, error: "读取书籍失败: " + e.message }, 500);
      }
    }

    // ---- 单本书实时库存 ----
    const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
    if (request.method === "GET" && bookMatch) {
      const id = Number(bookMatch[1]);
      const book = await env.DB.prepare(
        "SELECT id, title, author, cover, price, stock, category FROM books WHERE id = ?"
      ).bind(id).first();
      if (!book) return json({ ok: false, error: "书籍不存在" }, 404);
      return json({ ok: true, book });
    }

    // ---- 下单 ----
    if (request.method === "POST" && path === "/api/order") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
      }

      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const grade = String(body.grade || "").trim();
      const addr = String(body.addr || "").trim();
      const items = Array.isArray(body.items) ? body.items : [];

      if (!name || !phone) {
        return json({ ok: false, error: "姓名和手机号/微信号不能为空" }, 400);
      }
      if (items.length === 0) {
        return json({ ok: false, error: "购物车为空" }, 400);
      }

      // 归一化 + 去重合并（同一 id 多次出现合并数量）
      const map = new Map();
      for (const it of items) {
        const id = Number(it && it.id);
        const qty = Math.floor(Number(it && it.qty));
        if (!Number.isInteger(id) || id <= 0) continue;
        if (!Number.isInteger(qty) || qty <= 0) {
          return json({ ok: false, error: "商品数量必须为正整数" }, 400);
        }
        map.set(id, (map.get(id) || 0) + qty);
      }
      const norm = [...map.entries()].map(([id, qty]) => ({ id, qty }));
      if (norm.length === 0) {
        return json({ ok: false, error: "没有有效商品" }, 400);
      }

      const orderNo = genOrderNo();

      try {
        // 1) 预检：读取所有目标书籍当前库存 + 价格（用于快照与校验）
        const idList = norm.map((n) => n.id);
        const placeholders = idList.map(() => "?").join(",");
        const { results: rows } = await env.DB.prepare(
          `SELECT id, title, author, price, stock FROM books WHERE id IN (${placeholders})`
        ).bind(...idList).all();

        const rowMap = new Map(rows.map((r) => [r.id, r]));

        // 校验书籍都存在且库存充足
        for (const n of norm) {
          const row = rowMap.get(n.id);
          if (!row) {
            return json({ ok: false, error: `书籍不存在（id=${n.id}），请刷新后重试` }, 409);
          }
          if (row.stock < n.qty) {
            return json({
              ok: false,
              error: `「${row.title}」库存不足（剩余 ${row.stock}，需要 ${n.qty}）`,
              code: "OUT_OF_STOCK",
            }, 409);
          }
        }

        // 2) 事务：逐件原子扣库存（WHERE stock >= qty 防超卖）
        //    batch 是原子事务，任一失败全部回滚
        const stmts = norm.map((n) =>
          env.DB.prepare(
            "UPDATE books SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?"
          ).bind(n.qty, n.id, n.qty)
        );

        // 订单快照
        const snapshot = norm.map((n) => {
          const row = rowMap.get(n.id);
          return {
            id: row.id,
            title: row.title,
            author: row.author,
            price: row.price,
            qty: n.qty,
          };
        });
        const totalPrice = snapshot.reduce((s, it) => s + (it.price || 0) * it.qty, 0);
        const totalCount = snapshot.reduce((s, it) => s + it.qty, 0);

        // 将「扣库存 + 写订单」放进同一个 batch（同一事务）
        stmts.push(
          env.DB.prepare(
            `INSERT INTO orders (order_no, buyer_name, buyer_phone, buyer_grade, buyer_addr, items_json, total_price, total_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            orderNo, name, phone, grade, addr,
            JSON.stringify(snapshot), totalPrice, totalCount
          )
        );

        const results = await env.DB.batch(stmts);

        // 检查每个 UPDATE 的 changes：任一为 0 说明被并发抢空（理论上预检后仍可能发生）
        for (let i = 0; i < norm.length; i++) {
          const changes = results[i]?.meta?.changes ?? 0;
          if (changes === 0) {
            const row = rowMap.get(norm[i].id);
            return json({
              ok: false,
              error: `「${row?.title || norm[i].id}」刚刚被抢购，库存不足，请刷新后重试`,
              code: "OUT_OF_STOCK",
            }, 409);
          }
        }

        return json({
          ok: true,
          order_no: orderNo,
          total_price: totalPrice,
          total_count: totalCount,
          items: snapshot,
          message: "下单成功，库存已扣减",
        });
      } catch (e) {
        return json({ ok: false, error: "下单失败: " + e.message }, 500);
      }
    }

    return json({ ok: false, error: "Not Found" }, 404);
  },
};
