// screenshot.js
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const fs = require("fs-extra");
const path = require("path");
const sizeOf = require("image-size");
const OFFSET = 138;

// 安全命名函数
function safeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 40);
}

/**
 * 执行批量截图
 * @param {string} inputExcelPath - 上传的 Excel 文件路径
 * @param {string} outputDir - 输出目录（会自动创建子目录）
 * @returns {Promise<{ resultExcelPath: string, failedExcelPath: string|null, screenshotsDir: string, total: number, success: number, failed: number }>}
 */
async function runScreenshot(inputExcelPath, outputDir) {
  // 确保输出目录存在
  await fs.ensureDir(outputDir);
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.ensureDir(screenshotDir);

  // 读取 Excel
  const workbook = XLSX.readFile(inputExcelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  // 启动浏览器（headless: true 适合服务器）
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // 防止 /dev/shm 不足
      "--max_old_space_size=512", // 限制 V8 内存 512MB
      "--disable-gpu", // 禁用 GPU 加速（节省内存）
      // 👇 以下三个参数是专门为 Emoji 彩色字体加的
      "--enable-features=ColorFont",
      "--disable-features=Fontations",
      "--force-color-profile=srgb",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const result = [];
  const failed = [];

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const url = item["链接"];
    const author = safeName(item["作者昵称"] || "未知作者");

    console.log(`\n处理 ${i + 1}/${rows.length}`);
    console.log("作者:", author);
    console.log("链接:", url);

    try {
      // 等待页面完全加载
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

      // 关闭弹窗（与原来完全一致）
      const closeSelectors = [
        ".close",
        ".login-popup .close",
        '[aria-label="Close"]',
        ".ant-modal-close",
        ".dialog-close",
        ".modal-close",
      ];
      for (const sel of closeSelectors) {
        const btn = page.locator(sel);
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(500);
          break;
        }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);

      const parentSelector = "body > div.page.detail.js-page > div.main";
      const hideText = "今日热门推荐";

      // 等待父容器可见
      await page.waitForSelector(parentSelector, {
        state: "visible",
        timeout: 10000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      // 计算裁剪区域（基于文档坐标）
      const clipRect = await page.evaluate(
        ({ parentSel, text, offset }) => {
          const parent = document.querySelector(parentSel);
          if (!parent) return null;
          const parentRect = parent.getBoundingClientRect();
          const parentDocX = parentRect.left + window.scrollX;
          const parentDocY = parentRect.top + window.scrollY;

          // 只在父容器内查找，避免匹配到其他地方
          const all = parent.querySelectorAll("*");
          let hide = null;
          for (const el of all) {
            if (el.textContent.trim() === text) {
              hide = el;
              break;
            }
          }
          if (!hide) {
            return {
              x: parentDocX,
              y: parentDocY,
              width: parentRect.width,
              height: parentRect.height,
            };
          }
          const hideRect = hide.getBoundingClientRect();
          const hideDocY = hideRect.top + window.scrollY;
          // 裁剪高度 = hide 顶部 - 父容器顶部 - 额外偏移量（往上多裁一点）
          let height = hideDocY - parentDocY - offset;
          if (height <= 0) {
            return {
              x: parentDocX,
              y: parentDocY,
              width: parentRect.width,
              height: parentRect.height,
            };
          }
          return {
            x: parentDocX,
            y: parentDocY,
            width: parentRect.width,
            height: height,
          };
        },
        { parentSel: parentSelector, text: hideText, offset: OFFSET }, // ← 这里 offset 设为 30 像素，可调整
      );

      if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) {
        throw new Error("裁剪区域无效，高度或宽度为0");
      }

      const finalClip = {
        x: Math.round(clipRect.x),
        y: Math.round(clipRect.y),
        width: Math.round(clipRect.width),
        height: Math.round(clipRect.height),
      };
      console.log("裁剪区域（文档坐标）:", finalClip);

      const filename = `${String(i + 1).padStart(3, "0")}_${author}.png`;

      // 强制重绘（解决部分渲染问题）
      await page.evaluate(() => {
        document.body.style.display = "none";
        // 强制回流
        document.body.offsetHeight;
        document.body.style.display = "";
      });

      await page.screenshot({
        path: path.join(screenshotDir, filename),
        clip: finalClip,
        fullPage: true,
      });
      console.log("截图完成（裁剪）:", filename);

      result.push({
        序号: item["序号"] || i + 1,
        作者昵称: author,
        链接: url,
        截图文件名: filename,
      });

      await page.waitForTimeout(2000);
    } catch (error) {
      console.log("处理失败:", url);
      console.log(error.message);
      failed.push({
        序号: item["序号"] || i + 1,
        作者昵称: author,
        链接: url,
        原因: error.message,
      });
    }
  }

  await browser.close();

  // ---------- 生成结果 Excel ----------
  const resultExcelPath = path.join(outputDir, `result_${Date.now()}.xlsx`);
  const resultWorkbook = new ExcelJS.Workbook();
  const resultSheet = resultWorkbook.addWorksheet("截图结果");
  resultSheet.columns = [
    { header: "序号", key: "id", width: 8 },
    { header: "作者昵称", key: "author", width: 20 },
    { header: "缩略图", key: "image", width: 28 },
    { header: "链接", key: "url", width: 80 },
  ];
  resultSheet.getRow(1).font = { bold: true };
  resultSheet.views = [{ state: "frozen", ySplit: 1 }];
  resultSheet.autoFilter = "A1:D1";
  resultSheet.getColumn(3).alignment = {
    vertical: "middle",
    horizontal: "center",
  };
  resultSheet.getColumn(4).alignment = { vertical: "middle", wrapText: true };

  for (const item of result) {
    const row = resultSheet.addRow({
      id: item.序号,
      author: item.作者昵称,
      url: item.链接,
    });
    row.height = 120;

    const imagePath = path.join(screenshotDir, item.截图文件名);
    if (fs.existsSync(imagePath)) {
      const dimensions = sizeOf(imagePath);
      let width = dimensions.width;
      let height = dimensions.height;

      const maxWidth = 150;
      const maxHeight = 110;

      if (width > maxWidth) {
        height = height * (maxWidth / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = width * (maxHeight / height);
        height = maxHeight;
      }

      const imageId = resultWorkbook.addImage({
        filename: imagePath,
        extension: "png",
      });
      resultSheet.addImage(imageId, {
        tl: { col: 2.1, row: row.number - 1 + 0.1 },
        ext: { width: Math.round(width), height: Math.round(height) },
        editAs: "oneCell",
      });
    }
    row.getCell(4).value = { text: item.链接, hyperlink: item.链接 };
  }
  await resultWorkbook.xlsx.writeFile(resultExcelPath);
  console.log(`✅ 已生成结果 Excel：${resultExcelPath}`);

  // ---------- 生成失败记录（如果有） ----------
  let failedExcelPath = null;
  if (failed.length > 0) {
    failedExcelPath = path.join(outputDir, `failed_${Date.now()}.xlsx`);
    const failedWorkbook = new ExcelJS.Workbook();
    const failedSheet = failedWorkbook.addWorksheet("失败记录");
    failedSheet.columns = [
      { header: "序号", key: "id", width: 8 },
      { header: "作者昵称", key: "author", width: 20 },
      { header: "链接", key: "url", width: 80 },
      { header: "失败原因", key: "reason", width: 50 },
    ];
    failedSheet.getRow(1).font = { bold: true };
    failedSheet.views = [{ state: "frozen", ySplit: 1 }];
    failedSheet.autoFilter = "A1:D1";
    failedSheet.getColumn(3).alignment = { vertical: "middle", wrapText: true };
    failedSheet.getColumn(4).alignment = { vertical: "middle", wrapText: true };

    for (const item of failed) {
      const row = failedSheet.addRow({
        id: item.序号,
        author: item.作者昵称,
        url: item.链接,
        reason: item.原因,
      });
      if (item.链接) {
        row.getCell(3).value = { text: item.链接, hyperlink: item.链接 };
      }
    }
    await failedWorkbook.xlsx.writeFile(failedExcelPath);
    console.log(`⚠️ 失败记录已保存：${failedExcelPath}`);
  } else {
    console.log("✅ 没有失败记录");
  }

  return {
    resultExcelPath,
    failedExcelPath,
    screenshotDir,
    total: rows.length,
    success: result.length,
    failed: failed.length,
  };
}

module.exports = { runScreenshot };
