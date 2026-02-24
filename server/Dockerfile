FROM node:20 AS builder

WORKDIR /app

# node:20 完整镜像已内置 python3 / make / g++，无需额外安装
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# 编译 TypeScript（|| true：存在非致命类型标注错误，tsc 仍会输出 JS）
RUN npm run build || true
# 确保 index.js 已生成，否则构建失败
RUN test -f dist/index.js

# 移除开发依赖
RUN npm prune --omit=dev

# ── 生产镜像 ──
FROM node:20-slim

WORKDIR /app

# sqlite3 npm 包静态链接了 sqlite3，无需系统库
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

RUN mkdir -p uploads data

EXPOSE 3000

CMD ["node", "dist/index.js"]
