# dsh-bg

DSH web 页面背景切换插件：可以自由更换 DSH Web 界面左右面板的背景。

[![npm version](https://img.shields.io/npm/v/dsh-bg)](https://www.npmjs.com/package/dsh-bg)
[![npm downloads](https://img.shields.io/npm/dt/dsh-bg)](https://www.npmjs.com/package/dsh-bg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 快速开始（npm 安装）

```bash
dsh plugin --profile web add dsh-bg
```

然后**重启 dsh web 服务**（关闭 start-harness 窗口重新运行），刷新浏览器即可。

### 使用入口

设置页 → 通用（General）→「外观」下方 →「背景」行

### 更新

```bash
dsh plugin --profile web update dsh-bg
```

### 卸载

```bash
dsh plugin --profile web remove dsh-bg
```

> 需要 `dsh`（npm 全局）与 `pnpm`。安装后由 `dsh plugin` 自动把 `dsh-bg`
> 加入 profile 的 bundles 层，无需手改配置。

## 三种模式

| 模式 | 效果 |
| --- | --- |
| 左面板 | 只给左侧固定面板（会话列表 sidebar）换背景图 |
| 右面板 | 只给右侧抽拉面板（工具检查 details）换背景图 |
| 左右无缝 | 整屏铺同一张背景图，左右面板是同一张图的左右切片，视觉上是一张图无缝衔接（对话栏也显示图片中间部分） |

## 功能

- **当前背景预览**：迷你三栏布局示意图，实时预览当前模式下的背景效果
- 三种模式切换：左面板 / 右面板 / 左右无缝
- 上传背景图片（文件选择，多选）或直接**粘贴**剪贴板图片
- **动态壁纸（MP4）**：上传 MP4 视频作为背景，静音循环播放；视频 Blob 存 IndexedDB
  （`dsh-bg`/`media`），缩略图显示视频首帧，带「MP4」角标，同样可删可切换
- 图片库缩略图选择 / 删除（最多 8 项，图片单张 ≤ ~3.4MB，视频 ≤ 300MB）
- 「压暗遮罩」滑杆：给背景叠加深色遮罩，保证面板文字可读性
- 「图片不透明度」滑杆：0-100%，单独控制背景图片/视频本身的透明度（不影响遮罩）
- 「模糊度」滑杆：0-24px，给背景图片/视频加高斯模糊（毛玻璃效果，不影响文字清晰度）
- 「文字颜色」手动调整（配合背景图片提升可读性）：
  - 灰度模式（默认）：一个滑杆，黑(0) → 白(255)，整体调文字明度
  - RGB 模式（开关，默认关）：开启后显示 R/G/B 三个滑杆精确调色
- 「移除背景」一键清除当前背景（保留图片库）
- 配置持久化在浏览器 localStorage（`dsh-bg:config`），刷新不丢失

## 项目结构

```
dsh-bg/
├── package.json       dsh.client（平台 web，注入 slots）+ dsh.bundle.patch
├── cordis.patch.yml   插入 dsh-bg 插件行
└── lib/
    ├── index.js       host 侧占位（无行为）
    └── client.js      browser 侧：背景引擎 + 设置行 UI
```

## 本地开发

```bash
# 从项目目录安装到 web profile（会加入 dsh.profile.bundles 层）
dsh plugin --profile web add file:D:/deepseekharness/dsh-bg
```

重启后修改 `lib/client.js` 会通过 client-hmr（500ms 轮询）自动热更新，无需再重启。

## 实现要点

- 背景通过注入的 `<style data-plugin="dsh-bg">` 覆盖布局 CSS：
  - 左栏 `.sidebarCol`、右栏 `.detailsCol` 用 `[class$="_sidebarCol"]` /
    `[class$="_detailsCol"]` 后缀选择器匹配（CSS Modules 哈希前缀跨版本会变，语义后缀稳定）
  - 各面板内部不透明根节点（SidebarRoot / ConversationRoot / DetailsPanel）必须
    置为 `transparent`，否则会盖住列背景
- 「左右无缝」把图片铺在 AppFrame 根（`[class$="_frame"]:has(> [class$="_sidebarCol"])`，
  整屏）+ 三列全部透明，天然无缝且随面板开合/拖拽宽度自动正确
- HMR 重载时旧 `<style data-plugin>` 被移除、新 bundle 重新注入，无残留
- 详细设计与实现见 [docs/实施文档.md](docs/实施文档.md)

## 验证

- `node test-smoke.cjs`：模块级冒烟测试（三种模式 CSS 生成、apply() 激活、槽位注册）
- `node verify-cdp.mjs`：真实浏览器（headless Chrome + CDP）验证——需先以
  `--headless=new --remote-debugging-port=9222` 启动 Chrome 并打开 `http://127.0.0.1:3080`
- 已在运行中的 GUI 上实测确认（真实 computed style）：左右无缝整屏生效、左面板模式侧栏生效、
  右面板模式详情栏生效（面板为 DSH 控制宽度，展开即显示）、禁用后干净还原、0 控制台错误

## License

MIT
