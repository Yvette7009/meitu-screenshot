FROM node:18-slim

# 设置语言环境为中文（让浏览器优先用中文字体）
ENV LANG=zh_CN.UTF-8
ENV LANGUAGE=zh_CN:zh
ENV LC_ALL=zh_CN.UTF-8

# 安装系统依赖 + 中文字体
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libxshmfence1 \
    libasound2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libxrandr2 \
    libxss1 \
    libxt6 \
    libxcb1 \
    libxcb-shm0 \
    libxcb-xfixes0 \
    libxcb-shape0 \
    libxcb-randr0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-util1 \
    libxcb-render-util0 \
    libpango-1.0-0 \
    libcairo2 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libatspi2.0-0 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libfreetype6 \
    libgssapi-krb5-2 \
    libjpeg62 \
    libpng16-16 \
    libssl3 \
    libstdc++6 \
    libuuid1 \
    libx11-6 \
    libxinerama1 \
    libxrender1 \
    libz3-4 \
    # 👇 以下是中文字体
    fonts-wqy-zenhei \
    fonts-noto-cjk \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 刷新字体缓存（并验证是否安装成功）
RUN fc-cache -fv && fc-list :lang=zh | head -5

# 创建工作目录
WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装 Node 依赖
RUN npm install

# 安装 Playwright 浏览器
RUN npx playwright install chromium

# 复制项目源码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动
CMD ["node", "server.js"]