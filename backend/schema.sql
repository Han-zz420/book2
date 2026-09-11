-- ============================================================
-- 二手书平台 D1 数据库 schema
-- 库存权威来源：books.stock 字段，下单时在此原子扣减
-- ============================================================

-- 书籍表（首次部署时从 booklist.json 种子导入，之后以数据库为准）
CREATE TABLE IF NOT EXISTS books (
  id       INTEGER PRIMARY KEY,          -- 与 booklist.json 的 id 对应
  title    TEXT NOT NULL DEFAULT '',
  author   TEXT NOT NULL DEFAULT '',
  cover    TEXT NOT NULL DEFAULT '',      -- 封面相对路径，如 covers/image1.jpg
  price    REAL NOT NULL DEFAULT 9.9,     -- 单价（元）
  stock    INTEGER NOT NULL DEFAULT 0,    -- 当前可售库存（权威数据）
  category TEXT NOT NULL DEFAULT '',      -- 分类标签，如 "公共课"（空=默认/专业课）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：按 id 快速定位；stock 可用于售罄过滤
CREATE INDEX IF NOT EXISTS idx_books_id ON books(id);

-- 订单表（下单即扣库存并落一条订单记录，便于对账/回溯）
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no    TEXT NOT NULL UNIQUE,       -- 订单号（时间戳+随机）
  buyer_name  TEXT NOT NULL DEFAULT '',
  buyer_phone TEXT NOT NULL DEFAULT '',
  buyer_grade TEXT NOT NULL DEFAULT '',
  buyer_addr  TEXT NOT NULL DEFAULT '',
  items_json  TEXT NOT NULL DEFAULT '[]', -- 订单明细快照 [{id,title,price,qty}]
  total_price REAL NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'paid_pending', -- paid_pending|paid|cancelled
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
