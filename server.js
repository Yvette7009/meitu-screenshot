// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

console.log("🚀 正在启动服务器...");

const app = express();
const CLEANUP_DAYS = 5;
const HISTORY_FILE = path.join(__dirname, "history.json");

// ===== 文件上传配置 =====
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 20 * 1024 * 1024,
  },
});

app.use(express.static("public"));

// ===== 历史记录读写 =====
function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function writeHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ===== 清理旧目录 =====
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

// ===== 上传路由 =====
app.post("/upload", (req, res) => {
  upload.single("excel")(req, res, async (err) => {
    if (err) {
      console.error("上传错误:", err);
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ error: "文件太大，请上传小于 50MB 的 Excel" });
        }
        return res.status(400).json({ error: `上传错误: ${err.message}` });
      } else {
        return res
          .status(500)
          .json({ error: "上传中断，请检查网络或文件大小，重试" });
      }
    }

    console.log("📥 收到上传请求");
    try {
      if (!req.file) {
        return res.status(400).json({ error: "请上传 Excel 文件" });
      }

      const inputPath = req.file.path;
      const outputDir = path.join(__dirname, "output", Date.now().toString());
      await fs.ensureDir(outputDir);

      console.log("📸 开始执行截图...");
      const result = await runScreenshot(inputPath, outputDir);

      await fs.remove(inputPath);

      // ===== 记录历史 =====
      const history = readHistory();
      history.push({
        id: Date.now(),
        timestamp: new Date().toLocaleString(),
        inputFile: Buffer.from(req.file.originalname, "latin1").toString(
          "utf8",
        ),
        outputFile: path.basename(result.resultExcelPath),
        failedFile: result.failedExcelPath
          ? path.basename(result.failedExcelPath)
          : null,
        total: result.total,
        success: result.success,
        failed: result.failed,
        status:
          result.failed > 0
            ? result.success > 0
              ? "partial"
              : "failed"
            : "success",
      });
      writeHistory(history);

      // 异步清理旧目录
      cleanupOldOutputs().catch((err) =>
        console.warn("清理旧目录时出错:", err),
      );

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
});

// ===== 下载路由 =====
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

// ===== 历史记录接口 =====
app.get("/history", (req, res) => {
  const history = readHistory();
  res.json(history);
});

// ===== 超时设置 =====
app.use((req, res, next) => {
  req.setTimeout(600000);
  next();
});

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器已启动，监听端口 ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
});
