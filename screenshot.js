// screenshot.js
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const fs = require("fs-extra");
const path = require("path");
const sizeOf = require("image-size");

// 安全命名函数
function safeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 40);
}

/**
 * 执行批量截图
 */
async function runScreenshot(inputExcelPath, outputDir) {
  await fs.ensureDir(outputDir);
  const screenshotDir = path.join(outputDir, "screenshots");
  await fs.ensureDir(screenshotDir);

  const workbook = XLSX.readFile(inputExcelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--max_old_space_size=512",
      "--disable-gpu",
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

  // 定义选择器（你可以根据实际页面调整）
  const parentSelector = "body > div.page.detail.js-page > div.main";
  const topBoundarySelector =
    "body > div.page.detail.js-page > div.main > div.detail-cover.js-detail-cover.swiper-container.swiper-container-horizontal";

  // ===== 可调整参数 =====
  const BOTTOM_CROP = 138; // 想要裁掉的底部像素数，可调整
  // =====================

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const url = item["链接"];
    const author = safeName(item["作者昵称"] || "未知作者");

    console.log(`\n处理 ${i + 1}/${rows.length}`);
    console.log("作者:", author);
    console.log("链接:", url);

    try {
      // 1. 加载页面
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

      // 2. 关闭弹窗
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

      // 3. 等待父容器和顶部元素出现
      await page.waitForSelector(parentSelector, {
        state: "visible",
        timeout: 10000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      // 4. 计算裁剪区域：从 topBoundary 顶部 到 包含"打开app"文本的元素的底部，再减去 BOTTOM_CROP
      const clipRect = await page.evaluate(
        ({ parentSel, topSel, bottomText, bottomCrop }) => {
          const parent = document.querySelector(parentSel);
          const topEl = document.querySelector(topSel);
          if (!parent || !topEl) return null;

          // 查找包含 "打开app" 文本的元素
          const all = document.querySelectorAll("*");
          let bottomEl = null;
          for (const el of all) {
            const text = el.textContent.trim();
            if (text.includes(bottomText)) {
              bottomEl = el;
              break;
            }
          }

          // 如果文本找不到，降级为使用类名 .Widget.footer
          if (!bottomEl) {
            bottomEl = document.querySelector("div.Widget.footer.js-footer");
          }

          if (!bottomEl) {
            return null;
          }

          const parentRect = parent.getBoundingClientRect();
          const topRect = topEl.getBoundingClientRect();
          const bottomRect = bottomEl.getBoundingClientRect();

          const parentDocX = parentRect.left + window.scrollX;
          const topY = topRect.top + window.scrollY;
          // 底部终点 = bottomEl 底部 + 20 像素余量
          const bottomY = bottomRect.bottom + window.scrollY + 20;

          // 关键：减去 BOTTOM_CROP，直接裁掉底部多余部分
          let height = bottomY - topY - bottomCrop;
          if (height <= 0) return null;

          return {
            x: parentDocX,
            y: topY,
            width: parentRect.width,
            height: height,
          };
        },
        {
          parentSel: parentSelector,
          topSel: topBoundarySelector,
          bottomText: "打开app查看更多精彩内容>",
          bottomCrop: BOTTOM_CROP, // ← 传入偏移量
        },
      );

      if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) {
        throw new Error("裁剪区域无效，可能未找到顶部或底部元素");
      }

      const finalClip = {
        x: Math.round(clipRect.x),
        y: Math.round(clipRect.y),
        width: Math.round(clipRect.width),
        height: Math.round(clipRect.height),
      };
      console.log("裁剪区域（文档坐标）:", finalClip);

      // 5. 截图（直接保存，无中间步骤）
      const filename = `${String(i + 1).padStart(3, "0")}_${author}.png`;
      await page.screenshot({
        path: path.join(screenshotDir, filename),
        clip: finalClip,
        fullPage: true,
      });

      console.log("截图完成:", filename);

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

  // ---------- 生成结果 Excel（与之前完全相同） ----------
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

  // ---------- 失败记录 ----------
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
