# syntax=docker/dockerfile:1

# 依赖安装层：仅拷贝清单，最大化利用构建缓存。
# 验收与构建都不需要下载 Playwright 浏览器，显式跳过。
FROM node:22-alpine AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# 一次性验收：类型检查 + Vitest 单元测试 + 生产构建，全部通过才算成功。
FROM deps AS verify
COPY . .
CMD ["npm", "run", "verify"]

# 生产构建层：产出纯静态文件。
FROM deps AS build
COPY . .
RUN npm run build

# 唯一的静态 Web 服务：nginx 直接托管构建产物。
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
