// server.js
const express = require("express");
const fileUpload = require("express-fileupload"); // ← 替换 multer
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

console.log("🚀 正在启动服务器...");

const app = express();
const CLEANUP_DAYS = 5;

// ===== 文件上传配置（使用 express-fileupload） =====
app.use(
  fileUpload({
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
    abortOnLimit: true, // 超出限制直接返回错误
    responseOnLimit: "文件太大，请上传小于 50MB 的 Excel",
    // 可选：临时文件路径（默认会使用内存，小文件没问题）
    useTempFiles: false,
  }),
);

app.use(express.static("public"));

// 清理旧目录函数（保持不变）
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

// ===== 上传路由（使用 express-fileupload） =====
app.post("/upload", async (req, res) => {
  console.log("📥 收到上传请求");
  try {
    // 检查是否有文件
    if (!req.files || !req.files.excel) {
      return res.status(400).json({ error: "请上传 Excel 文件" });
    }

    const file = req.files.excel;
    // 检查文件类型（可选）
    const ext = path.extname(file.name).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      return res.status(400).json({ error: "仅支持 .xlsx 或 .xls 格式" });
    }

    // 将文件保存到临时目录
    const inputPath = path.join(
      __dirname,
      "uploads",
      `${Date.now()}_${file.name}`,
    );
    await fs.ensureDir(path.dirname(inputPath));
    await file.mv(inputPath);

    const outputDir = path.join(__dirname, "output", Date.now().toString());
    await fs.ensureDir(outputDir);

    console.log("📸 开始执行截图...");
    const result = await runScreenshot(inputPath, outputDir);

    // 删除临时文件
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

// ===== 下载路由（保持不变） =====
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

// ===== 超时设置（保持不变） =====
app.use((req, res, next) => {
  req.setTimeout(600000); // 10 分钟
  next();
});

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器已启动，监听端口 ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
});
