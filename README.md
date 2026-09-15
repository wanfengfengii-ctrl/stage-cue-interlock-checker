# 舞台提示序列裁决器

纯浏览器应用（TypeScript + React + Vite）：监督员以事件卡片录入提示编号与动作，
可删除、可拖动排序；每次编辑都从首项重新裁决整条序列，直接看出序列可否照单执行，
或准确定位首次破坏舞台互锁的位置。

## 操作规则

### 提示状态机

每个提示（按**提示编号**区分）初始为 **空闲**，状态流转如下：

```
空闲 ──候场──▶ 候场中 ──执行──▶ 执行中 ──完成──▶ 已完成
 ▲               │
 └─────取消──────┘
```

- **仅空闲**的提示可以 **候场**（候场后进入候场中）；
- **仅候场中**的提示可以 **执行** 或 **取消**；
- **取消** 让提示回到 **空闲**，之后可重新候场；
- **仅执行中**的提示可以 **完成**；
- **已完成** 的提示不再接收任何动作；
- **任一时刻最多一个提示处于执行中**（舞台互锁）。

### 裁决规则

- 每次编辑（新增、删除、拖动排序）都**从首项重新裁决**整条序列；
- 序列**合法**时：展示每一步之后各提示的状态，并给出“序列合法，可照单执行”；
- 序列**非法**时：**停止在首个违规卡片**，显示**违规前状态**与**唯一原因**，
  该卡片之后的旧结果一律清除（卡片标记为“未裁决”）；
- 表单错误（如提示编号为空）与裁决违规都会在页面上明确反馈。

### 界面操作

1. 在“提示编号”输入框填写编号，选择动作（候场 / 执行 / 完成 / 取消），点击 **添加卡片**；
2. 卡片列表中按住卡片**拖动**即可调整顺序，点击 **删除** 移除卡片；
3. “裁决结果”区实时展示每步后的提示状态或首个违规的详情。

## 本地开发

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器
npm run test         # Vitest：裁决逻辑单元测试
npm run typecheck    # TypeScript 类型检查
npm run build        # 生产构建（含类型检查）
npm run e2e          # Playwright：拖动排序后的主流程（需先 npx playwright install chromium）
npm run verify       # 一次性验收：类型检查 + 单元测试 + 构建
```

## Docker

`docker-compose.yml` 只运行一个静态 Web 服务（nginx 托管构建产物），
另提供名为 **verify** 的一次性验收服务：

```bash
docker compose up web                  # 默认 http://localhost:8080
WEB_PORT=9000 docker compose up web    # WEB_PORT 覆盖宿主端口
docker compose run --rm verify         # 一次性验收：类型检查 + Vitest + 构建，完成后退出
```

## 目录结构

```
src/lib/adjudicate.ts   # 裁决逻辑（纯函数，Vitest 覆盖）
src/App.tsx             # 卡片录入 / 删除 / 拖动排序 / 裁决结果展示
tests/adjudicate.test.ts  # 裁决逻辑单元测试
e2e/main-flow.spec.ts     # Playwright 主流程（含拖动排序）
Dockerfile              # 多阶段：verify（验收）与 web（静态托管）
docker-compose.yml      # web（WEB_PORT 可覆盖）+ verify（一次性）
```
