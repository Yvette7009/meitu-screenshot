// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

console.log("🚀 正在启动服务器...");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));

app.post("/upload", upload.single("excel"), async (req, res) => {
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

app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const outputRoot = path.join(__dirname, "output");
  if (!fs.existsSync(outputRoot)) {
    return res.status(404).send("文件不存在");
  }
  const dirs = fs.readdirSync(outputRoot, { withFileTypes: true });
  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const filePath = path.join(outputRoot, dir.name, filename);
      if (fs.existsSync(filePath)) {
        return res.download(filePath);
      }
    }
  }
  res.status(404).send("文件不存在");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器已启动，监听端口 ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
});
