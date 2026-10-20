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

1. 启动现有后端，确保 PostgreSQL、模型和 TTS 已配置。无需修改后端 API。
2. 用 **微信开发者工具**导入本目录 `apps/wechat-miniprogram/`，使用自己的 AppID。`project.config.json` 的 `touristappid` 只用于允许的本地体验，不代表可发布的小程序。
3. 打开「连接设置」，填写后端地址。开发者工具在同一 Mac 上可使用 `http://127.0.0.1:3000`，本机预览需在「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本及 HTTPS 证书」并重新编译。也可在本地 `project.private.config.json` 中设置 `setting.urlCheck: false`；该文件优先于公共配置，且不提交到版本库。公共 `project.config.json` 保持 `urlCheck: true`，用于正式环境校验。
4. 真机需要手机可访问的服务地址。正式环境使用 HTTPS，在小程序后台配置 **request 和 downloadFile 合法域名**。目前 Mac 上监听 `127.0.0.1` 的服务不能被手机直接访问；这里不会自动把服务暴露到公网。
5. 后端启用 `ACCESS_CODE` 时，输入访问码后连接。访问码仅用于兑换会话，客户端不持久化其明文。

模块不接入 `wx.login`：它沿用后端现有身份机制。匿名模式下，小程序与电脑浏览器默认拥有不同的课程库；清理存储会失去匿名身份。若部署使用宿主 SSO/自定义身份，需另行接入对应登录流程；不会绕过身份验证或读取其他所有者的数据。

## 互动课堂配置

课程页提供「进入互动课堂」。小程序先用现有 Cookie 身份请求 `/api/miniapp/launch`，服务端确认课程和章节属于当前用户后，签发 60 秒、单次使用的随机票据。票据只出现在 URL fragment 中，不包含 Cookie 或模型密钥；页面兑换后立即移除 fragment，将同一身份恢复到 HttpOnly 会话，再加载 `/miniapp/classroom/<id>`。返回并再次打开时会申请新票据。

- 正式环境需为同一 HTTPS 服务配置微信 **web-view 业务域名**，并确认账号支持该组件；它与 request/downloadFile 合法域名分别配置。嵌入的外部网页及资源也需要符合微信域名规则。
- 开发者工具本地调试需关闭 web-view 域名和 HTTPS 校验；手机真机不能访问 Mac 的 localhost。本机 HTTP 服务以 production 模式启动时，应在其启动环境设置 `COOKIE_SECURE=0`，否则 WebView 浏览器可能丢弃安全 Cookie 并丢失课程身份。正式 HTTPS 部署保留默认安全 Cookie。
- 当前交接使用单进程内存票据，适合本项目的单实例部署；重启或负载均衡到其他实例时，返回小程序重新进入。多实例部署需共享票据存储或保持实例粘性。
- 只交接内置 Cookie 身份与访问码会话。依赖宿主认证头的 SSO 若不能由这些 Cookie 还原相同所有者，会明确拒绝，不创建一个看似成功的空课程库。
- PBL 的对话、提交、评阅及学习状态沿用现有 Web 运行时和服务端持久化；需要对应后端模型配置。小程序本地选择题答案仍独立保存，不自动作为 PBL 的先修测验记录。

## 边界

这是独立原生移动学习 UI，不是桌面功能的完整移植：

- 基础课件预览支持文本、图片、矩形形状和直线。任意 SVG 路径、复杂图表、LaTeX 排版、动画、白板动作不保证视觉等价；竖屏讲义提供可读文字。
- HTML 模拟、PBL 与白板动画通过小程序内的 `web-view` 竖屏互动课堂执行，复用服务端课程与完整运行引擎，不把任意 HTML/JS 转写为 WXML。HTML 保持沙箱隔离，支持缩放操作；PBL 的任务、讨论、提交面板可触屏切换；白板保留绘制/清除动画，并支持单指拖动与双指缩放。
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
  pages/activity/        # 小程序内的竖屏 HTML / PBL / 白板课堂
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
# 可选：需要可连接的现有后端，不调用 LLM，也不生成付费语音。
# 会在独立匿名身份下创建测试课程壳，并在 finally 中删除该测试课程。
OPENMAIC_TEST_URL=http://127.0.0.1:3000 node apps/wechat-miniprogram/scripts/smoke.cjs
```

也可在本模块运行 `npm run check` 和 `npm test`（不需要安装依赖）。

这些检查覆盖请求会话、Cookie 隔离、私有资源请求、轮询停止及测验适配；**不能代替微信开发者工具编译和真机验收**。发布还需要实际 AppID、合法域名和微信平台审核。

官方参考：[微信小程序示例](https://github.com/wechat-miniprogram/miniprogram-demo)、[wx.request](https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html)、[wx.createInnerAudioContext](https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/wx.createInnerAudioContext.html)、[downloadFile 域名配置](https://docs.cloudbase.net/lowcode/practices/miniapp-guide/downloadfile-guide)。
