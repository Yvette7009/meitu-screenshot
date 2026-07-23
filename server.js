// server.js
const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { runScreenshot } = require("./screenshot");

const app = express();
const upload = multer({ dest: "uploads/" }); // 临时存放上传的文件

// 提供静态页面（public 目录下的 index.html）
app.use(express.static("public"));

// 处理上传
app.post("/upload", upload.single("excel"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "请上传 Excel 文件" });
    }

    const inputPath = req.file.path;
    // 为每次处理创建一个独立目录（用时间戳）
    const outputDir = path.join(__dirname, "output", Date.now().toString());
    await fs.ensureDir(outputDir);

    // 执行截图
    const result = await runScreenshot(inputPath, outputDir);

    // 删除上传的临时文件
    await fs.remove(inputPath);

    // 返回结果信息，包含下载链接
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
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 下载文件
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  // 在 output 目录下查找文件（遍历所有子目录）
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

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 服务器已启动，请访问 http://localhost:${PORT}`);
});
