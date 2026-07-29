// screenshot.js - 最终稳定版
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const fs = require("fs-extra");
const path = require("path");
const sizeOf = require("image-size");

function safeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 40);
}

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

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const url = item["链接"];
    const author = safeName(item["作者昵称"] || "未知作者");

    console.log(`\n处理 ${i + 1}/${rows.length}`);
    console.log("作者:", author);
    console.log("链接:", url);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

      // 关闭弹窗
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
      await page.waitForSelector(parentSelector, {
        state: "visible",
        timeout: 10000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      // ================= 彻底隐藏底部干扰元素 =================
      await page.evaluate(() => {
        // 1. 通过文本查找并隐藏
        const unwantedTexts = ["今日热门推荐", "打开app查看更多精彩内容"];
        const all = document.querySelectorAll("*");
        const toHide = new Set();

        for (const el of all) {
          const text = el.textContent.trim();
          for (const unwanted of unwantedTexts) {
            if (text === unwanted || text.includes(unwanted)) {
              // 向上找到最近的容器类（Widget 或 footer）
              let parent = el;
              while (parent && parent !== document.body) {
                if (
                  parent.classList &&
                  (parent.classList.contains("Widget") ||
                    parent.classList.contains("footer"))
                ) {
                  toHide.add(parent);
                  break;
                }
                parent = parent.parentElement;
              }
              toHide.add(el);
              break;
            }
          }
        }

        // 2. 通过已知类名隐藏
        const classSelectors = [
          "div.Widget.other-content",
          "div.Widget.footer.js-footer",
          "div.detail-footer",
        ];
        for (const sel of classSelectors) {
          const el = document.querySelector(sel);
          if (el) toHide.add(el);
        }

        // 3. 全部隐藏
        for (const el of toHide) {
          if (el) el.style.display = "none";
        }

        // 4. 移除父容器底部额外间距
        const main = document.querySelector(
          "body > div.page.detail.js-page > div.main",
        );
        if (main) {
          main.style.paddingBottom = "0";
          main.style.marginBottom = "0";
        }
      });

      // ================= 直接截图父容器 =================
      const parentElement = page.locator(parentSelector).first();
      const filename = `${String(i + 1).padStart(3, "0")}_${author}.png`;
      await parentElement.screenshot({
        path: path.join(screenshotDir, filename),
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
