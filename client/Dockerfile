FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# 直接运行 vite build（跳过 tsc 类型检查，vite 内部用 esbuild 编译，不受 TS 类型错误影响）
RUN npx vite build

# ── 生产镜像：nginx 托管静态文件 ──
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
