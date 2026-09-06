// 把 照片/ 下的原图压缩为适合网页展示的缩略图，输出到 covers/（文件名不变）
const nodeFs = require("node:fs");
const { promises: fs } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SRC = path.resolve("照片");
const OUT = path.resolve("covers");
const LONG_EDGE = 760;      // 长边像素（高清可缩放，且总量须 < 25MB 上传上限）
const QUALITY = 76;

// 只处理 booklist.json 里仍被引用的图，并删除未引用的孤儿封面
const bookFiles = new Set(
  (JSON.parse(nodeFs.readFileSync(path.resolve("booklist.json"), "utf8")))
    .map((b) => b.file)
    .filter(Boolean)
);

(async () => {
  await fs.mkdir(OUT, { recursive: true });

  const files = (await fs.readdir(SRC))
    .filter((f) => /\.jpe?g$/i.test(f) && bookFiles.has(f))
    .sort();

  // 删除未引用的孤儿封面
  const keep = new Set(files);
  const orphan = (await fs.readdir(OUT)).filter((f) => !keep.has(f));
  for (const f of orphan) await fs.unlink(path.join(OUT, f)).catch(() => {});
  if (orphan.length) console.log(`已清理未引用封面 ${orphan.length} 张`);

  console.log(`待处理: ${files.length} 张`);

  const errors = [];
  let done = 0;

  async function worker(file) {
    const src = path.join(SRC, file);
    const out = path.join(OUT, file.replace(/\.jpe?g$/i, ".jpg"));
    try {
      const img = sharp(src, { failOn: "none" });
      const meta = await img.metadata();
      const isLandscape = (meta.width || 1) >= (meta.height || 1);
      const opts = isLandscape
        ? { width: LONG_EDGE, height: null }
        : { height: LONG_EDGE, width: null };
      await img
        .rotate() // 应用 EXIF 方向
        .resize({ ...opts, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toFile(out);
      done++;
      if (done % 50 === 0 || done === files.length) console.log(`进度: ${done}/${files.length}`);
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
    }
  }

  // 简单并发池
  const CONCURRENCY = 4;
  let i = 0;
  async function pool() {
    const jobs = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      jobs.push((async () => {
        while (i < files.length) {
          const f = files[i++];
          await worker(f);
        }
      })());
    }
    await Promise.all(jobs);
  }

  await pool();

  if (errors.length) {
    console.log(`\n失败 ${errors.length} 张:`);
    errors.forEach((e) => console.log(" - " + e));
  }

  // 汇总输出目录大小
  const outs = await fs.readdir(OUT);
  let bytes = 0;
  for (const f of outs) bytes += (await fs.stat(path.join(OUT, f))).size;
  console.log(`\n完成: ${outs.length} 张, 共 ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${OUT}`);
})();
