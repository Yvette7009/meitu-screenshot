const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

console.log("🚀 正在启动服务器...");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));

// 上传路由（简化）
app.post("/upload", (req, res) => {
  upload.single("excel")(req, res, async (err) => {
    if (err) {
      console.error("上传错误:", err);
      return res.status(400).json({ error: "上传失败: " + err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "没有文件" });
    }

    try {
      const outputDir = path.join(__dirname, "output", Date.now().toString());
      await fs.ensureDir(outputDir);
      const result = await runScreenshot(req.file.path, outputDir);
      await fs.remove(req.file.path);

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
    } catch (error) {
      console.error("处理出错:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const outputRoot = path.join(__dirname, "output");
  if (!fs.existsSync(outputRoot)) return res.status(404).send("未找到");
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
    if (fs.existsSync(filePath)) return res.download(filePath);
  }
  res.status(404).send("文件不存在");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ 服务器运行在 http://localhost:${PORT}`));
