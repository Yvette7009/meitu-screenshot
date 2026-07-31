// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

console.log("🚀 正在启动服务器...");

const app = express();
const CLEANUP_DAYS = 5;

// ===== 1. 配置 Multer =====
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// ===== 2. 调试中间件：打印请求头 =====
app.use((req, res, next) => {
  if (req.path === "/upload") {
    console.log("📋 请求方法:", req.method);
    console.log("📋 Content-Type:", req.headers["content-type"]);
  }
  next();
});

// ===== 3. 静态文件 =====
app.use(express.static("public"));

// ===== 4. 上传路由 =====
app.post("/upload", upload.single("excel"), async (req, res) => {
  console.log("📥 收到上传请求");
  console.log("req.file:", req.file);
  console.log("req.body:", req.body);

  try {
    // 检查文件是否存在
    if (!req.file) {
      return res.status(400).json({
        error:
          "没有收到文件，请确保表单字段名为 'excel'，且 Content-Type 为 multipart/form-data",
        debug: {
          headers: req.headers,
          body: req.body,
        },
      });
    }

    const inputPath = req.file.path;
    const outputDir = path.join(__dirname, "output", Date.now().toString());
    await fs.ensureDir(outputDir);

    console.log("📸 开始执行截图...");
    const result = await runScreenshot(inputPath, outputDir);

    await fs.remove(inputPath);

    // 异步清理旧目录
    cleanupOldOutputs().catch((err) => console.warn("清理旧目录时出错:", err));

    res.json({
      success: true,
      resultExcel: `/download/${path.basename(result.resultExcelPath)}`,
      failedExcel: result.failedExcelPath
        ? `/download/${path.basename(result.failedExcelPath)}`
        : null,
      total: result.total,
      successCount: result.success,
      failedCount: result.failed,
    });
    console.log("✅ 处理完成，已返回结果");
  } catch (error) {
    console.error("❌ 处理出错:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== 5. 下载路由（不变） =====
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const outputRoot = path.join(__dirname, "output");
  if (!fs.existsSync(outputRoot)) {
    return res.status(404).send("文件不存在");
  }
  const dirs = fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      path: path.join(outputRoot, d.name),
      mtime: fs.statSync(path.join(outputRoot, d.name)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const dir of dirs) {
    const filePath = path.join(dir.path, filename);
    if (fs.existsSync(filePath)) {
      return res.download(filePath);
    }
  }
  res.status(404).send("文件不存在");
});

// ===== 6. 清理函数 =====
async function cleanupOldOutputs() {
  const outputRoot = path.join(__dirname, "output");
  if (!fs.existsSync(outputRoot)) return;
  const now = Date.now();
  const dirs = fs.readdirSync(outputRoot, { withFileTypes: true });
  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const dirPath = path.join(outputRoot, dir.name);
      const stat = fs.statSync(dirPath);
      const ageDays = (now - stat.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > CLEANUP_DAYS) {
        await fs.remove(dirPath);
        console.log(`🧹 清理旧目录: ${dir.name}`);
      }
    }
  }
}

// ===== 7. 超时设置 =====
app.use((req, res, next) => {
  req.setTimeout(600000);
  next();
});

// ===== 8. 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器已启动，监听端口 ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
});
