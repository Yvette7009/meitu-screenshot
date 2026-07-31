// screenshot.js
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const XLSX = require("xlsx");
const fs = require("fs-extra");
const path = require("path");
const sizeOf = require("image-size");

// 安全命名
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

  // ========== 配置 ==========
  const parentSelector = "body > div.page.detail.js-page > div.main";
  const TOP_CROP = 0; // 顶部裁掉 0px（可根据需要调整）
  // 底部不再固定裁剪，而是动态定位到互动区 inputBox
  // =========================

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const url = item["链接"];
    const author = safeName(item["作者昵称"] || "未知作者");

    console.log(`\n处理 ${i + 1}/${rows.length}`);
    console.log("作者:", author);
    console.log("链接:", url);

    try {
      // 1. 加载页面，等待所有资源完成
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });

      // 2. 关闭弹窗（保持不变）
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

      // ===== 自动展开全部文案 =====
      try {
        const containerSelector =
          "body > div.page.detail.js-page > div.main > div.detail-footer > div.description.js-description > div";
        const expandBtn = page.locator(containerSelector + " >> text=展开全部");
        if ((await expandBtn.count()) > 0) {
          await expandBtn.click();
          console.log("✅ 已点击展开全部");
          await page.waitForTimeout(1000);
          await page
            .waitForLoadState("networkidle0", { timeout: 5000 })
            .catch(() => {});
        } else {
          console.log("ℹ️ 未找到展开按钮，无需展开");
        }
      } catch (err) {
        console.warn("展开操作出错:", err.message);
      }

      // 3. 等待父容器可见
      await page.waitForSelector(parentSelector, {
        state: "visible",
        timeout: 10000,
      });
      await page
        .waitForLoadState("networkidle0", { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      // 4. 滚动到页面底部，触发懒加载（确保互动区加载）
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(1500);

      // 5. 隐藏底部不需要的元素（今日热门推荐、打开app等）
      await page.evaluate(() => {
        const hot = document.querySelector("div.Widget.hot.js-widget-hot");
        if (hot) hot.style.display = "none";
        const footer = document.querySelector("div.Widget.footer.js-footer");
        if (footer) footer.style.display = "none";
      });

      // 6. 强制重绘（确保样式应用）
      await page.evaluate(() => {
        document.body.style.display = "none";
        document.body.offsetHeight;
        document.body.style.display = "";
      });

      // 7. 计算裁剪区域：顶部固定，底部动态定位到互动区 inputBox
      const clipRect = await page.evaluate(
        ({ parentSel, topCrop }) => {
          const parent = document.querySelector(parentSel);
          if (!parent) return null;

          const parentRect = parent.getBoundingClientRect();
          const parentDocX = parentRect.left + window.scrollX;
          const parentDocY = parentRect.top + window.scrollY;

          const topY = parentDocY + topCrop;

          // 寻找互动区容器
          let bottomY = parentRect.bottom + window.scrollY;
          const inputBox = document.querySelector(
            "div.inputBox.js-default.js-input-box",
          );
          if (inputBox) {
            const inputRect = inputBox.getBoundingClientRect();
            bottomY = inputRect.bottom + window.scrollY + 20; // 加 20px 余量
            console.log("✅ 找到互动区 inputBox，底部位置:", bottomY);
          } else {
            console.warn("⚠️ 未找到互动区 inputBox，使用父容器底部");
          }

          const height = bottomY - topY;
          if (height <= 0) {
            // 降级：使用父容器高度减去顶部偏移
            return {
              x: parentDocX,
              y: topY,
              width: parentRect.width,
              height: parentRect.height - topCrop,
            };
          }

          return {
            x: parentDocX,
            y: topY,
            width: parentRect.width,
            height: height,
          };
        },
        {
          parentSel: parentSelector,
          topCrop: TOP_CROP,
        },
      );

      if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) {
        throw new Error("裁剪区域无效");
      }

      const finalClip = {
        x: Math.round(clipRect.x),
        y: Math.round(clipRect.y),
        width: Math.round(clipRect.width),
        height: Math.round(clipRect.height),
      };
      console.log("裁剪区域（文档坐标）:", finalClip);

      // 8. 截图
      const filename = `${String(i + 1).padStart(3, "0")}_${author}.png`;
      await page.screenshot({
        path: path.join(screenshotDir, filename),
        clip: finalClip,
        fullPage: true, // 确保与 clip 配合正确
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
