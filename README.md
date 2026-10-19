# dsh-whale-girl-plugin · DeepSeek 鲸鱼娘看板娘

给 DeepSeek Harness Web GUI 注入一只常驻的 **DeepSeek 鲸鱼娘**看板娘：透明立绘、待机动画、随 AI 状态切表情、会说话、可拖动，全部可配置。**纯注入、零侵入、免构建**。

![素材总览](docs/preview.png)

## 特性

| 能力 | 说明 |
|------|------|
| **事件桥（v0.3）** | 直接订阅宿主 cordis 事件（`agent/status`、`agent/assistant-stream`、`tools/pre-execute`/`tools/result`、`agent/turn-stopping`、`agent/error`、`approval/request`、`user-questions/request`、`subagent/start|end`、`agent/inbox/*`），折成 10 个相位经 SSE 推给页面；**桥优先、DOM 传感兜底**，桥断流自动退回，面板可手动开关；`tool` 相位台词能点名工具（正在跑 pwsh 呢～） |
| 状态机（操作驱动） | 优先级：**操作瞬态（戳/拖/甩鼠标）> AI 瞬态（完成/出错）> AI 持续态（工作中/思考/等待输入）> 待机动态 > 打盹**；任何瞬态都有独立回落定时器，**到点必定回到当前真实状态**，绝不卡在某个表情上 |
| 待机动态 | 待机/等待输入/工作中都用 `idle.webm` 透明动画（视频不可用才退回 `idle.png` + 浮动）；**待机久了会自己玩**：每 16~34s 随机来一个小动作（瞟一眼/点头/摆尾/哼歌/伸懒腰/好奇"咦？"，快到入睡时间会打哈欠） |
| 说话口型 + 逐字气泡 | 气泡逐字显示（26 字/秒），口型同步开合，长句自动延长停留；**台词全部是角色口吻**（104 条：语气词、尾巴/深海/摸鱼梗、小傲娇），不念状态名、没有"现在是：XX"这类系统播报 |
| 9 种表情 | 待机 / 思考 / 完成 / 出错 / 生气 / 打盹 / 头晕 / 等待输入 + 说话口型，按 AI 实时状态与你的操作自动切换 |
| 交互分级 | 单击=按**点击位置**分区反应（摸头/戳身体/碰尾巴各说各的）+ 轻跳 → 连点 3 次="咦？" → 连点 5 次=生气；双击=逐个演示表情（限时自动回落，并说一句该情绪的台词） |
| 拖拽物理感 | 拖拽时按水平速度倾斜（≤7°）→ 松手**惯性滑动**一小段 + 落位小弹跳 + 位置记忆；贴到屏幕左右边缘会朝屏幕内**探头** |
| 贴边偷看会眨眼 | 拖到屏幕左/右边缘停留 2 秒就进入"扒墙偷看"保持态；**这张保持态是静帧，所以眼睛原本是死的** —— v0.15.0 起引擎每隔 2.2~6.2 秒把画面切成 `act-peek-03-blink.png`（闭眼帧）约 130ms，**就是一次真眨眼**，另外还有 ±2.4° 的慢速微摆，看起来和待机态一样"活着" |
| 鼠标逼近反应 | 快速把鼠标推到身上会"吓一跳"（后仰 + ？+ 台词，6s 冷却）；滚动页面时视线跟着内容走 |
| 音效（默认关） | WebAudio **合成音零素材**（单击/轻跳/完成/出错，指数包络防爆音）+ 可选待机 BGM（源 MP4 抽出的 `idle.ogg`）；全部**懒初始化 + 用户手势启动**，被自动播放策略挡下时静默等待；设置面板一键开关，隐藏时自动停 |
| 悬停反馈 | 鼠标移到角色身上轻微放大（1.03）并唤醒/恢复运动 |
| 感知 AI | MutationObserver 观察 dsh 的 `data-streaming` / `data-variant="think"[data-state]` / `[data-tool][data-state]` / `.turnErrorRow` / `[data-composer-input]:focus`；**错误行按"一次性事件（签名去重）"处理**，不会永久卡在难过表情 |
| 鼠标速度分档 | 慢=视线跟随；明显挥动=视线跟得更紧（不换脸）；**真的甩起来**（>5px/ms 且持续 420ms 且窗口内位移 >120px）才头晕，2.6s 后回待机 |
| 鼠标转速 → 头晕 | 三重门槛防误触发：阈值 5px/ms + 持续 420ms + 窗口位移 120px；旋涡眼 + 左右摇摆 + ☆ 粒子 + 台词；`behavior.dizzyMood` 可换成别的表情 |
| 连点 → 生气 | 4 秒内点 5 次 → 生气表情与台词，2.2s 后自动回待机 |
| 闲置打盹 | 10 分钟无操作（且 AI 空闲）→ 打哈欠铺垫 → 打盹 + **持续冒 Zzz + 可见呼吸**；任意交互唤醒 |
| 主题跟随 | 直接用 dsh 设计令牌 `--dsw-*`，深浅色与第三方主题自动一致；`.dgw-dark` 作为兜底 |
| 不吃点击 | 命中层按角色剪影 `clip-path` 裁切，透明留白处鼠标穿透到 dsh 界面 |
| 永不变死图 | 视频/立绘只用 opacity 叠层（不切 display）+ 1.5s 播放看门狗 + 有限重试；一次性动画后面串无限呼吸；减少动态效果时也保留极轻呼吸 |
| 源码热更新 | 改 `engine.mjs` / `mascot.config.mjs` / `character.mjs` **不用重启 dsh**：宿主每 2s 比对 mtime 自动重建注入片段，刷新页面即生效（写错语法时保留上一份可用片段并在日志告警） |
| 设置面板 | **表头可拖动、位置记忆、双击表头复位**；缩放 / 不透明度 / 自动说话 / 视线跟随 / 头晕 / 连点生气 / 待机动画 / 锁定位置 / 表情预览 / 位置重置，写入 localStorage |

## 安装

```powershell
# 在本机 dsh 的 profile 里安装（profile 名以实际为准，这里是 web）
dsh plugin --profile web add D:\dsh-code\whale-girl-plugin
# 安装后重启 dsh，并刷新一次浏览器页面（引擎在 index.html 渲染时注入）
```

## 自检

```powershell
# 1) 静态自检：注入片段语法、素材齐备、路径穿越防护、事件桥相位机、台词数据模型、清单一致性
node tools/check-inject.mjs

# 1b) 运行时冒烟：在 Node 里用最小浏览器桩真跑一遍引擎（启动/待机/情绪/气泡/事件桥/台词覆写/清理）
node tools/smoke-test.mjs

# 或者一把梭（静态 + 运行时）
npm test

# 2) 运行期自检：路由是否注册、素材是否能取到、注入片段是否非空、事件桥相位
curl http://127.0.0.1:3080/__mascot/status
# → {"activeWorkspace":"dsh-code",...,"diagnostics":{"version":"0.3.0","injectBytes":...,"needsRestart":[],
#      "bridge":{"phase":"idle","tool":null,"counters":{...}}}}

# 3) 事件桥实时流（不用浏览器就能看 AI 在干什么；发一条消息观察 thinking→working→tool→done）
curl -N http://127.0.0.1:3080/__mascot/events
```

想换语言：设置面板 →「台词语言」→ English（默认"自动"跟随界面语言）；想自己改台词：设置面板 →「台词（本地覆写）」；想加一门语言：往 `locale/` 放一个 `mascot.<lang>.json` 即可（键照抄中文池子）。

浏览器控制台调试钩子：

```js
window.__dshWhaleGirl.dump()            // 当前情绪/感知状态/设置/视觉/运动诊断
window.__dshWhaleGirl.motion()          // ★ 诊断"为什么不动"：shouldMove / video.paused / cssAnimation / reducedMotion …
window.__dshWhaleGirl.nudge()           // 强制把"该动的"拉回运动状态（唤醒 + 恢复播放 + 重同步）
window.__dshWhaleGirl.setMood('dizzy')  // 手动切表情（9 种 id，见 character.mjs）
window.__dshWhaleGirl.speak('测试')      // 手动说话（走气泡 + 口型）
window.__dshWhaleGirl.moods()           // 所有情绪 id
```

## 改完代码怎么生效

| 改动 | 生效方式 |
|------|----------|
| `mascot.config.mjs` / `character.mjs` / `engine.mjs` | **不用重启 dsh**：宿主每 2s 比对 mtime 自动重建注入片段，**刷新页面**即可（`/__mascot/status` 的 `diagnostics.hotReloads` 能看到重建次数） |
| `backend.mjs` / `index.js` / `package.json` | 重启 dsh（Host 侧模块换代）。改了但没重启时：`/__mascot/status` 的 `diagnostics.needsRestart` 会列出这两个文件，服务端日志也会提示一次 |
| `assets/`（素材） | 刷新页面即可；路由按 mtime 发 ETag，`?v=<版本>` 会随 `package.json` 版本号破缓存 |

> 为什么 HMR 不接管？dsh 的 HMR 默认忽略 `**/node_modules`（`packages/boot/hmr/src/index.ts:215`），而本插件是链接安装（`node_modules` 下的 junction），所以模块换代只能靠重启——这也正是这里自己做 mtime 轮询的原因。

## 配置

改 `mascot.config.mjs`（改配置不改引擎，改完刷新页面即可）：

| 字段 | 默认 | 说明 |
|------|------|------|
| `imgHeight` / `defaultScale` | 200 / 1.0 | 画布高度（3:4）与缩放；`minScale`~`maxScale` 可调 |
| `defaultPos` | 右下角 24/18 | 初始位置（px）；拖拽后以 localStorage 为准 |
| `idleMotion` | `'video'` | `'static'` 则只用静态待机图 + CSS 浮动 |
| `videoIdlePauseMs` | 8000 | 连续停在静态表情超过这么久就暂停视频省电（回到会动的情绪/看门狗会立刻恢复） |
| `videoRetries` | 3 | 待机动画加载/播放失败的自动重试次数（避免一次失败就永久静态） |
| `talkFps` | 5 | 口型基准帧率（实际帧间隔 ±30% 抖动） |
| `bubbleDurationMs` / `speakCoolDownMs` / `idleSpeakIntervalMs` | 4200 / 6000 / 45000 | 气泡停留、发言冷却、闲置发言间隔 |
| `followCursor` / `lookMaxOffset` / `lookSmooth` | true / 8 / 0.08 | 视线跟随开关与强度（v0.15.3 起设置面板暂不显示该开关，见下一行） |
| `showFollowCursorToggle` | false | 设置面板是否显示"视线跟随"开关。**默认隐藏**：真·眼珠跟随层已回滚，只剩很轻微的伪 3D 转头，留着容易被当成"点了没效果"；想临时验收改 `true` 即可（功能始终按 `followCursor` 生效） |
| `dizzy*` | 5 px/ms、420ms、120px、窗口 150ms | 头晕**三重门槛**：速度阈值 / 持续时长 / 窗口内最小位移（已调钝，防随手移动误触发）；想更敏感就把这三个数字调小 |
| `angry*` | 5 次 / 4000ms | 连点生气的触发条件 |
| `previewHoldMs` | 3000 | 双击/面板手动换表情的停留时长（到点自动回到真实状态） |
| `behavior.transientMs` | dizzy 2600 / angry 2200 / think 1300 / poke 800 | 各类"操作型"瞬态停留时长（到点必回真实状态） |
| `behavior.speedMood` | 3 档 | 鼠标速度（px/ms）分档：`≤2.6` 正常 / `≤5.0` 视线跟更紧（不换脸）/ 更快 → 头晕；`look` 是视线强度倍率，`mood` 是命中该档时的表情 |
| `behavior.dizzyMood` | `'dizzy'` | 头晕用哪个表情（想换成难过就填 `'error'`） |
| `behavior.idleMicroMinMs/MaxMs` | 16000 / 34000 | 待机小动作的随机间隔（`character.mjs` 的 `micro` 表就是待机时的"自娱自乐"动作库） |
| `behavior.hoverScale` / `dragTiltMaxDeg` / `dragSettleMs` | 1.03 / 7 / 460 | 悬停放大、拖拽最大倾斜角、落位回弹时长 |
| `behavior.typewriterCps` | 26 | 气泡逐字速度（字/秒），0 = 整句直接显示 |
| `behavior.clickThinkAt` / `clickAngryAt` | 3 / 5 | 连点第 N 次"咦？"，第 N 次生气 |
| `behavior.userTransientDuringWork` | true | AI 干活时用户操作是否也立刻有反馈（true = 操作优先、更跟手） |
| `idleToSleepAfterMs` | 10 分钟 | 闲置入睡阈值 |
| `sensors` | 见文件 | DOM 感知选择器（dsh 改版只改这里；感知不到只影响自动表情，不影响使用） |
| `hitPolygon` | 自动生成 | 角色剪影多边形，用于命中区域裁切 |
| `storageKey` | `dshWhaleGirl.settings` | localStorage 键名（存 `v` 版本号，缺字段用默认值合并） |

台词池在 `character.mjs`：每个情绪一个 `pool`，另有 `interact`（点击/拖拽）、`random`（彩蛋）、`time`（早安/午间/下午/夜间）、`context`（`{workspace}`）。

## 文件结构

```
whale-girl-plugin/
├─ index.js            Host 入口：tapIndex 注入 + 路由注册（effect 清理，热重载安全）
├─ backend.mjs         /__mascot/asset/<file>（白名单 + ETag/304 + Range 206）
│                      /__mascot/status（活跃 workspace + 自检信息）
├─ engine.mjs          前端引擎（IIFE 字符串）：状态机/口型/气泡/交互/感知/主题/设置
├─ character.mjs       角色层：9 种情绪的素材文件名、动画、口型开关、台词池
├─ mascot.config.mjs   配置中心（显示/发言/视线/头晕/生气/感知/主题/命中区域）
├─ assets/             运行期素材：9 张透明 PNG + 3 帧扒墙偷看 + 1 张闭眼帧 + idle.webm（共约 2.7MB）
├─ docs/preview.png    素材总览；docs/eye-life-preview.png / eye-life-realsize.png 是闭眼帧的目视验收图
├─ icon.png            插件图标（显示清单要求，≤256KiB）
├─ locale/{zh,en}.json 插件管理器里的标题与描述
├─ tools/
│   ├─ build-assets.ps1  素材流水线（从 source/ 原始素材重建 assets/）
│   ├─ import-actions.ps1 动作序列帧导入（多帧共用一个锚点，避免播放抖动）
│   ├─ build-eye-life.ps1 从保持态那一帧生成"闭眼帧"（贴边偷看眨眼用）
│   ├─ keytool.cs        抠图/对齐/剪影的 C# 实现（System.Drawing）
│   └─ check-inject.mjs  交付前自检
└─ cordis.patch.yml    bundle 层：声明插件 id
```

## 常见问题

- **看不到看板娘**：确认安装后刷新过页面；`curl /__mascot/status` 看 `diagnostics.injectHasEngine` 是否为 true；浏览器控制台是否有报错。
- **它变成一张不会动的图了**：控制台执行 `window.__dshWhaleGirl.motion()` 看卡在哪一步——
  - `shouldMove: false` → 当前情绪的静帧本来就该静止（思考/完成/出错/打盹/生气/头晕），或者正处于"等待输入"之外的真实状态；`nudge()` 可强制拉回；
  - `video.paused: true` 且 `shouldMove: true` → 自动播放被策略挡了，`nudge()` 或随便点一下页面即可恢复（看门狗 1.5s 内也会自己拉回）；
  - `reducedMotion: true` → 系统开了"减少动态效果"，此时**故意**只用静态立绘；在设置面板里也能自己确认。
- **只有静态图、完全不动**：`idle.webm` 没加载成功（控制台会有一条 warn）——检查 `/__mascot/asset/idle.webm` 是否 200；或在设置面板关掉"待机动画"。
- **表情不随 AI 状态变**：dsh 前端改版导致选择器失效，改 `mascot.config.mjs` 的 `sensors` 即可（`window.__dshWhaleGirl.dump()` 里的 `sensorMood` 能看到当前识别结果）。
- **挡住界面按钮**：拖动挪开，或右键 → 隐藏（`Alt+Shift+W` 唤回）；命中区域已按剪影裁切，透明处点击会穿透。
- **气泡太吵**：设置面板关掉"自动说话"，或调大 `speakCoolDownMs` / `idleSpeakIntervalMs`。

## 许可与素材来源

插件代码 MIT。角色立绘与待机动画由用户提供（AI 生成素材，源 MP4 内含 AIGC 标注元数据），仅在本插件中分发使用。
