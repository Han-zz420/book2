# 二手书平台库存改造部署指南

> 目标：把库存从「静态 JSON + 客户端 localStorage」迁移到「Cloudflare D1 数据库 + Workers API」，实现下单扣库存的服务端持久化与多用户并发一致。

---

## 一、整体架构

```
浏览器/微信小程序
   │  HTTPS
   ▼
Cloudflare Workers  (backend/)  ← 新增后端 API
   │  SQL (D1)
   ▼
Cloudflare D1 数据库  (books 表)  ← 库存权威来源
```

- **前端**（`index.html`）：仍在 Cloudflare Pages 静态托管，不动部署方式。
- **后端**（`backend/`）：Cloudflare Workers，提供 `/api/books`、`/api/order`。
- **数据库**：Cloudflare D1（云端 SQLite），免费额度：读 500 万行/天、写 10 万行/天、5GB 存储。

> 为什么用 D1 而不是 MySQL：Cloudflare 免费方案（Pages/Workers）没有常驻进程、装不了 MySQL。D1 是 Cloudflare 原生数据库，免费额度充足，且与 Workers 同生态、延迟最低、免运维。

---

## 二、目录结构

```
book2/
├── index.html              # 前端（已改造：下单调 /api/order，库存调 /api/books）
├── index.template.html     # 前端模板（改动源头）
├── booklist.json           # 书籍静态资料（书名/价格/封面；库存初始化后由 D1 接管）
├── build-page.cjs          # 生成 index.html（前端发布前运行）
└── backend/
    ├── wrangler.toml       # Workers + D1 配置
    ├── package.json
    ├── schema.sql          # 建表 SQL（books + orders）
    ├── seed.sql            # 种子数据（由 booklist.json 生成）
    ├── generate-seed.cjs   # 重新生成 seed.sql 的脚本
    └── src/
        └── index.js        # Workers API 逻辑
```

---

## 三、部署步骤（一次性）

> ✅ **已完成的步骤**（本次会话已执行）：
> - D1 数据库 `bookshop-db` 已创建，`database_id = 54057f6e-605d-4167-95a0-3018fc49be7d`（已填入 wrangler.toml）
> - 建表 + 导入 551 本书（含 18 本公共课）已成功执行
> - 剩余：`wrangler deploy`（发布 Workers）——因代理网络波动暂未成功，网络恢复后重跑即可

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 登录 Cloudflare（首次）

```bash
npx wrangler login
```

浏览器会弹出授权页，登录你的 Cloudflare 账号（即托管 Pages 的那个账号）。

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create bookshop-db
```

命令会输出类似：

```
✅ Created database 'bookshop-db' with database_id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把输出的 `database_id` 填入 `backend/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "bookshop-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # ← 替换这里
```

### 4. 初始化数据库（建表 + 导入书籍）

```bash
# 建表
npx wrangler d1 execute bookshop-db --remote --file=./schema.sql

# 导入书籍种子数据（533 条，从 booklist.json 生成）
npx wrangler d1 execute bookshop-db --remote --file=./seed.sql
```

> 以后改了 `booklist.json` 的书名/价格/库存，先跑 `node generate-seed.cjs` 重新生成 `seed.sql`，再执行上面导入命令即可覆盖（`seed.sql` 会先 `DELETE FROM books` 再全量插入）。

### 5. 发布 Workers

```bash
npx wrangler deploy
```

成功后输出 Workers 地址，形如：

```
https://bookshop-api.<你的子域>.workers.dev
```

### 6. 配置前端 API 地址

编辑 `index.template.html`，把 `API_BASE` 填成 Workers 地址：

```js
const API_BASE = "https://bookshop-api.<你的子域>.workers.dev";
```

> 两种方式二选一：
> - **跨域直连**：如上，填完整 Workers 地址（API 已配 CORS 允许 `*`）。
> - **同域（推荐）**：在 Cloudflare Dashboard 给 Workers 绑定一个路由（如 `api.你的域名.com/*`），再把 `API_BASE` 填成 `https://api.你的域名.com`，或直接留空并让 Pages 项目把 `/api/*` 路由到该 Worker。

### 7. 重新构建并发布前端

```bash
# 回到项目根目录
cd ..
node build-page.cjs
```

把生成的 `index.html`（连同 `covers/`、`二维码.jpg`）重新部署到 Cloudflare Pages。

---

## 四、本地联调（验证 API 逻辑）

```bash
cd backend
npm install
npx wrangler dev          # 启动本地 Workers，默认 http://127.0.0.1:8787
```

另开一个终端初始化本地 D1 并导入数据：

```bash
cd backend
npx wrangler d1 execute bookshop-db --local --file=./schema.sql
npx wrangler d1 execute bookshop-db --local --file=./seed.sql
```

测试接口：

```bash
# 健康检查
curl http://127.0.0.1:8787/api/health

# 书籍列表（含实时库存）
curl http://127.0.0.1:8787/api/books

# 下单（扣 1 本 id=1 的书）
curl -X POST http://127.0.0.1:8787/api/order \
  -H "Content-Type: application/json" \
  -d '{"name":"张三","phone":"13800000000","grade":"大一","addr":"3栋501","items":[{"id":1,"qty":1}]}'

# 再次查询，确认 id=1 的 stock 已 -1
curl http://127.0.0.1:8787/api/books/1
```

本地联调时，可把 `index.template.html` 里的 `API_BASE` 临时设为 `http://127.0.0.1:8787`，用浏览器打开 `index.html` 走完整下单流程。

---

## 五、并发一致性说明

- D1 底层是 SQLite（单写者模型），`env.DB.batch()` 是一个**原子事务**：要么全部提交，要么全部回滚。
- 扣库存用：
  ```sql
  UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?
  ```
  `WHERE stock >= qty` 保证「库存不足时该行不受影响（changes=0）」，从根上杜绝并发超卖。
- 下单 = 扣库存 + 写订单，放进同一个 `batch`，保证二者原子；任一本书库存不足，整个事务回滚，并向前端返回 `OUT_OF_STOCK`，前端会刷新库存提示用户。

---

## 六、日常维护

| 操作 | 命令 |
|------|------|
| 改书名/价格/库存后同步 | `cd backend && node generate-seed.cjs && npx wrangler d1 execute bookshop-db --remote --file=./seed.sql` |
| 查看某本书实时库存 | `curl https://<workers>/api/books/<id>` |
| 查看订单表 | `npx wrangler d1 execute bookshop-db --remote --command "SELECT * FROM orders ORDER BY id DESC LIMIT 20"` |
| 手动调库存 | `npx wrangler d1 execute bookshop-db --remote --command "UPDATE books SET stock=10 WHERE id=1"` |
| 重新发布后端 | `cd backend && npx wrangler deploy` |
| 重新发布前端 | 改模板 → `node build-page.cjs` → 上传 Pages |

---

## 七、注意事项

1. **库存以 D1 为准**：前端 `booklist.json` 里的 `stock` 仅在首次 `seed` 时生效，之后一切以 D1 数据库为准。改库存请用 D1 命令，别只改 `booklist.json` 重新 build（那样不会动线上库存）。
2. **`booklist.json` 仍保留**：它是书名/价格/封面的「静态底数」来源，前端 build 时仍注入这些字段；只是库存字段被 API 实时覆盖。
3. **回滚**：若想退回纯静态，把 `index.template.html` 里 `API_BASE` 相关改动还原即可，不影响数据库数据。
