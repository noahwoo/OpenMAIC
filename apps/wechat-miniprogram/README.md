# OpenMAIC 微信小程序前端

独立原生小程序模块，界面为简体中文，使用 JavaScript / WXML / WXSS，无需运行 Next.js、React 或 npm 构建。直接复用现有 OpenMAIC 服务端，不新增模型密钥或微信 AppSecret 到客户端。

## 已实现

- **竖屏学习空间**：课程搜索、课程列表、后台生成任务、下拉刷新、失败与空状态。
- **创建课程**：学习目标输入、灵感预设、大纲审核开关、防重复提交。模型和 TTS 路由由服务端决定。
- **进度页**：显示大纲、逐节进度、当前步骤；确认大纲、失败重试、打开已生成内容。轮询串行执行，页面隐藏后停止，重新进入时恢复。
- **原生课堂**：横向章节导航、前后翻页、双指缩放的基础课件预览、竖屏文字讲义、教师讲解逐段阅读、私有音频下载及连续播放。切后台/切章节停止播放，销毁页面清理临时资源。
- **测验**：单选/多选练习、本地反馈及解析；简答题记录但不自动判分。练习答案和阅读位置按服务地址/课程隔离保存在本机。
- **连接设置**：服务地址、可选访问码；Cookie 按服务地址隔离，初次并发请求共用一个身份初始化，防止创建多个匿名学习空间。

## 开始使用

1. 启动现有后端，确保 PostgreSQL、模型和 TTS 已配置。使用包含原生适配 API 的同版本后端；原生模拟缓存表在首次访问时自动创建。
2. 用 **微信开发者工具**导入本目录 `apps/wechat-miniprogram/`，使用自己的 AppID。`project.config.json` 的 `touristappid` 只用于允许的本地体验，不代表可发布的小程序。
3. 打开「连接设置」，填写后端地址。开发者工具在同一 Mac 上可使用 `http://127.0.0.1:3000`，本机预览需在「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本及 HTTPS 证书」并重新编译。也可在本地 `project.private.config.json` 中设置 `setting.urlCheck: false`；该文件优先于公共配置，且不提交到版本库。公共 `project.config.json` 保持 `urlCheck: true`，用于正式环境校验。
4. 真机需要手机可访问的服务地址。正式环境使用 HTTPS，在小程序后台配置 **request 和 downloadFile 合法域名**。目前 Mac 上监听 `127.0.0.1` 的服务不能被手机直接访问；这里不会自动把服务暴露到公网。
5. 后端启用 `ACCESS_CODE` 时，输入访问码后连接。访问码仅用于兑换会话，客户端不持久化其明文。

模块不接入 `wx.login`：它沿用后端现有身份机制。匿名模式下，小程序与电脑浏览器默认拥有不同的课程库；清理存储会失去匿名身份。若部署使用宿主 SSO/自定义身份，需另行接入对应登录流程；不会绕过身份验证或读取其他所有者的数据。

## 原生互动课堂

课程页的「进入互动课堂」使用 WXML、WXSS、小程序 JavaScript 与 Canvas 2D，不加载 web-view。

- 模拟：首次访问 `/api/miniapp/native/<stageId>/<sceneId>` 时，由现有 `scene-content` 模型将课程 HTML 的学习目标转换为受限 JSON。固定 WXML 模板渲染参数滑杆、结果卡片、实验步骤与 Canvas 图形；只解释数字/变量/白名单公式，不执行模型生成的代码。结果缓存于 PostgreSQL，原课程修改后自动失效。无法表达核心目标时显示具体不支持原因，不能转换的外链不会被猜测成通用演示。
- PBL：原生任务列表、导师/情境对话、文本或作品链接提交、评阅、完成确认及阶段切换。后端从已授权课程和 RuntimeStore 恢复项目，客户端只发送操作与版本号；不会接收客户端修改的完整项目。输入和成果先落库，模型失败后可重试评阅；并发窗口改变进度时返回冲突并刷新。使用已有 PBL 任务规则和完成证据，不跳过评阅直接标记完成。
- 白板：读取课程已有动作，Canvas 原生绘制文本、图形、线条、表格与图表，播放书写/绘制/清除序列，支持暂停、拖动进度及重播。隐藏页面时停止动画。

原生访问只需 request/downloadFile 域名，无需 web-view 业务域名。后端模型密钥留在服务端。首次转换和 PBL 模型调用最长等待 120 秒。课程所有权在每次请求及模型返回后检查；学习记录与网页端使用相同服务端存储，是否为同一身份仍取决于现有登录方式。小程序本地测验记录不会自动作为 PBL 的先修测验记录。

旧 `/miniapp` 浏览器兼容入口仍保留，但本小程序不再使用。

## 边界

这是独立原生移动学习 UI，不是桌面功能的完整移植：

- 基础课件预览支持文本、图片、矩形形状和直线。任意 SVG 路径、复杂图表、LaTeX 排版、动画、白板动作不保证视觉等价；竖屏讲义提供可读文字。
- 原生模拟是按核心学习目标重新建模，不保证任意 HTML 的像素及功能等价；当前原语限于参数、公式、基础几何图形和步骤动画。白板公式显示 LaTeX 文本，代码行级编辑显示说明；暂不提供复杂公式排版、代码高亮及拖动缩放。PBL 支持文本与链接成果，不含文件上传。
- 单选/多选反馈基于课程内已有答案，本地练习记录暂不回写服务端 RuntimeStore。简答题不自动判分。
- 不包含语音录入、材料上传、多人聊天、桌面编辑器、PPTX 导出或微信账号跨端同步。
- 图片和音频使用现有 `ast_…` 资产引用，通过带会话 Cookie 的 `wx.downloadFile` 获取。旧课程若仍使用浏览器本地音频 ID，需先在网页版完成资源迁移。
- 内容和讲解由模型生成，应用可完成生成不等于内容经过教学准确性审核。

## 目录

```text
miniprogram/
  app.*                  # 路由和全局移动端视觉样式
  pages/home/            # 课程库、生成任务
  pages/create/          # 创建课程
  pages/progress/        # 轮询、确认大纲和重试
  pages/classroom/       # 竖屏课堂、讲义、音频、测验
  pages/settings/        # 后端与访问码连接
  pages/activity/        # 原生模拟 / PBL / 白板课堂
  components/native-canvas/ # Canvas 2D 原生绘制与动画
  utils/native-spec.js    # 受限模拟格式校验及公式解释器
  utils/native-draw.js    # 原生模拟和白板绘制
  components/slide-view/ # 原生基础课件预览
  utils/client.js        # 可测试的网络与 Cookie 边界
  utils/api.js           # wx 适配和连接配置
  utils/poller.js        # 生命周期安全的串行轮询
  utils/course.js        # 现有 API / DSL 视图适配
scripts/check.cjs        # 页面/组件图、JS/JSON、事件绑定检查
scripts/smoke.cjs        # 可选：真实本地后端的身份和课程契约验证
```

## 验证

在仓库根目录运行：

```sh
pnpm check:miniapp
pnpm test:miniapp
pnpm exec vitest run tests/server/miniapp-native
# 可选：真实模型调用，使用现有 scene-content 模型和服务端凭证
OPENMAIC_NATIVE_LIVE=1 TEST_LOAD_LOCAL_ENV=1 pnpm exec vitest run tests/server/miniapp-native/live-generation.test.ts
# 可选：需要可连接的现有后端，不调用 LLM，也不生成付费语音。
# 会在独立匿名身份下创建测试课程壳，并在 finally 中删除该测试课程。
OPENMAIC_TEST_URL=http://127.0.0.1:3000 node apps/wechat-miniprogram/scripts/smoke.cjs
```

也可在本模块运行 `npm run check` 和 `npm test`（不需要安装依赖）。

这些检查覆盖请求会话、Cookie 隔离、私有资源请求、轮询停止及测验适配；**不能代替微信开发者工具编译和真机验收**。发布还需要实际 AppID、合法域名和微信平台审核。

官方参考：[微信小程序示例](https://github.com/wechat-miniprogram/miniprogram-demo)、[wx.request](https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html)、[wx.createInnerAudioContext](https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/wx.createInnerAudioContext.html)、[downloadFile 域名配置](https://docs.cloudbase.net/lowcode/practices/miniapp-guide/downloadfile-guide)。
