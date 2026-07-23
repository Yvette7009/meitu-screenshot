FROM node:18-slim

ENV LANG=zh_CN.UTF-8
ENV LANGUAGE=zh_CN:zh
ENV LC_ALL=zh_CN.UTF-8

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
    fonts-wqy-zenhei \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-symbola \                  # ← 新增：备选 Emoji 字体
    xfonts-base \ 
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 强制刷新字体缓存并打印日志，确认 Emoji 字体已加载
RUN fc-cache -fv && fc-list | grep -i emoji

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npx playwright install chromium

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]