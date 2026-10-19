// mascot.config.mjs — DeepSeek 鲸鱼娘看板娘 · 配置中心
// 所有"可变的东西"集中在这里：外观/位置/发言/口型/视线/鼠标转速/生气/感知选择器/主题/持久化。
// 改这里不改引擎，最大化灵活性。
//
// 素材相关：assets/ 目录下的透明 PNG 表情集 + idle.webm 待机动画（VP9 alpha），
// 由 tools/build-assets.ps1 从 source/ 原始素材生成，文件名与 character.mjs 一一对应。
export default {
  name: 'whale-girl',
  label: 'DeepSeek 鲸鱼娘',

  // —— 挂载与显示 ——
  mountTarget: 'body',            // 挂载节点
  defaultPos: { right: 24, bottom: 18 }, // 对话界面右下角（相对视口，px）
  imgHeight: 200,                 // 立绘显示高度 px（画布 3:4，宽度等比）
  defaultScale: 1.0,              // 默认缩放
  minScale: 0.6, maxScale: 2.0,   // 缩放范围
  defaultOpacity: 1.0,            // 默认不透明度 (0.2~1)
  zIndex: 8000,                   // 高于内容、低于 dsh 弹窗层

  // —— 待机动画 / 口型 ——
  idleMotion: 'video',            // 'video' 用 idle.webm 待机动画；'static' 只用 idle.png + CSS 浮动
  idleVideo: 'idle.webm',         // 待机动画文件（未就绪/加载失败自动回退静态图）
  idleFadeMs: 220,                // 视频与静态图切换的淡入淡出
  videoIdlePauseMs: 8000,         // 连续停在静态表情超过这么久就暂停视频省电（回到会动的情绪立刻恢复）
  videoRetries: 3,                // 待机动画加载/播放失败的自动重试次数（避免一次失败就永久静态）
  talkFps: 5,                     // 说话口型基准帧率（实际帧间隔在此基础上 ±30% 抖动，更像人说话）

  // —— 气泡与发言 ——
  bubbleDurationMs: 4200,         // 气泡停留时长
  speakCoolDownMs: 6000,          // 两次自动发言最小间隔
  idleSpeakIntervalMs: 45000,     // 闲置随机发言间隔
  recentPoolSize: 8,              // 台词去重环形队列长度

  // —— 视线跟随（整只角色的位移 + 伪 3D 转头）——
  followCursor: true,             // 是否跟随鼠标（角色轻微"看你"）
  showFollowCursorToggle: false,  // v0.15.3 设置面板暂不显示"视线跟随"开关：
                                  // 真·眼珠跟随层（v0.14.0）已回滚，只剩很轻微的伪 3D 转头，
                                  // 留着开关容易被当成"点了没效果"。临时想验收就改 true（功能一直按 followCursor 生效）
  lookSmooth: 0.08,               // 插值系数/帧
  lookMaxOffset: 8,               // 最大跟随偏移 px
  // 伪 3D 转头：让它从"整图平移"变成"转头看你"（透视 + rotateY/rotateX，枢轴在脖子）
  // 详见开发文档第二十二节；真·眼珠位移属第二阶段，需要额外图层素材
  gaze: {
    enabled: true,
    maxYawDeg: 7,                 // 左右转头最大角度（超过 ~10° 会像"卡片在转"）
    maxPitchDeg: 4,               // 上下抬头/低头最大角度
    smooth: 0.18,                 // 每帧向目标角度逼近的比例（越大越跟手）
    perspectivePx: 700,           // 透视距离：越小越"近"，同样角度看起来幅度更大
    pivotY: 0.58                  // 旋转枢轴（相对画布高度，0.58 大致在脖子）
  },

  // —— 休闲动作（动态待机动作：原地跑步 / 扒墙偷看 / 趴着看 / 掏折扇…）——
  idleActs: {
    enabled: true,
    minGapMs: 45000,               // 随机调度：两次休闲动作的最小间隔
    maxGapMs: 120000,              // 随机调度：最大间隔
    edgeWithinPx: 14,              // 距边界多少像素内算“贴住墙 / 地面”
    // 贴边触发：拖到屏幕左/右边缘后不用等随机调度，停留一下就演（v0.13.2）
    edgeTrigger: true,
    edgeDwellMs: 2000,             // 贴边持续多久触发
    edgeCooldownMs: 24000,         // 一直贴在原地时的重复冷却
    edgeSwitchCooldownMs: 1500,    // 换到另一侧算"新一次到访"，冷却只留很短（否则右侧像是不生效）
    edgeIgnoreAiState: true,       // 贴边时不管 AI 是否在干活都演（用户要求：贴到墙边就演）
    edgePollMs: 500                // 检测频率
  },

  // —— 行为层：状态如何"跟着操作智能切换" ——
  // 优先级模型（越想越简单、越可预期）：
  //   操作瞬态（戳/拖/甩鼠标）  >  AI 瞬态（完成/出错）  >  AI 持续态（工作中/思考/等待输入）  >  待机动态  >  打盹
  // 规则：① 任何瞬态都有独立的回落定时器，到点必定回到"当前真实状态"；
  //      ② 待机时永远用 idle.webm 待机动态（视频不可用才退回静图+浮动）；
  //      ③ 待机久了会自己做一些小动作（character.mjs 的 micro），待机不是一模一样地循环。
  behavior: {
    userTransientDuringWork: true,  // AI 干活时用户操作是否也要立刻有反应（true = 操作优先，更跟手）
    transientMs: {                  // 各类"操作型"瞬态停留时长（到点必回真实状态）
      dizzy: 2600,                  // 甩鼠标头晕
      angry: 2200,                  // 连点生气
      think: 1300,                  // 连点"咦？"
      poke: 800                     // 单击轻跳（不换脸）
    },
    dizzyMood: 'dizzy',             // 头晕用哪个表情；想改成"难过"就填 'error'
    speedMood: [                    // 鼠标速度分档（px/ms，<=max 命中该档）
      { max: 2.6, mood: null, look: 1.0 },        // 日常移动：只做视线跟随
      { max: 5.0, mood: null, look: 1.3 },        // 明显挥动：视线跟得紧一点（仍不换脸）
      { max: 999, mood: 'dizzy', look: 1.3 }      // 真的要"甩"：还要持续 dizzyHoldMs 才头晕
    ],
    idleMicroMinMs: 16000,          // 待机小动作随机间隔下限
    idleMicroMaxMs: 34000,          // 上限
    idleMicroBeforeSleepRatio: 0.85,// 接近入睡阈值时改用"打哈欠"小动作
    hoverScale: 1.03,               // 鼠标悬停轻微放大
    dragTiltMaxDeg: 7,              // 拖拽时按水平速度倾斜的最大角度
    dragSettleMs: 460,              // 松手落位回弹时长
    typewriterCps: 26,              // 气泡逐字速度（字/秒）；0 = 整句直接显示
    clickThinkAt: 3,                // 连点到第 N 次开始"咦？"
    clickAngryAt: 5,                // 连点到第 N 次生气
    dragInertia: true,              // 拖拽松手后按速度滑一小段（更有重量感）
    edgePeek: true,                 // 贴到屏幕左右边缘时朝屏幕内"探头"
    edgePeekDeg: 7,                 // 探头倾斜角度
    edgePeekWithinPx: 14,           // 距边缘多少像素内算"贴边"
    startle: true,                  // 鼠标快速逼近时"吓一跳"（后仰 + ？粒子）
    startleRadiusPx: 150,           // 进入这个半径内才可能被吓到
    startleApproachPx: 90,          // 200ms 内逼近这么多像素算"快速逼近"
    startleCooldownMs: 6000,        // 吓一跳冷却，免得一直抖
    clickZones: true,               // 按点击位置分区反应（头/身体/尾巴）
    scrollGaze: true                // 页面滚动时视线跟着内容走
  },

  // —— 台词引擎：权重与条件、语气梯度 ——
  dialogue: {
    streakResetMs: 60000,           // 连续同类事件间隔超过这么久就重新计数（语气梯度用）
    nightStart: 22,                 // "夜里"起点（含）
    nightEnd: 5,                    // "夜里"终点（不含），可跨零点
    weights: true                   // 条目权重生效；置 false = 全部等概率（排查"某句一直说"时用）
  },

  // —— 无障碍 ——
  a11y: {
    keyboard: true,                 // 角色可 Tab 聚焦：回车说话 / 方向键挪位 / H 隐藏
    stillMode: false                // true = 默认"完全静止"（也可在设置面板随时切）
  },


  // —— 事件桥（v0.3）：宿主 cordis 事件 → SSE → 引擎 ——
  // 这是"精确状态"（宿主直接告诉你 AI 在干什么）；桥没有帧时引擎自动退回 DOM 传感。
  bridge: {
    enabled: true,
    path: '/__mascot/events',       // 与 backend.mjs 注册的 exact 路由一致
    staleMs: 8000,                  // 超过这么久没收到帧就当桥断了（自动退回 DOM 传感）
    retryMs: 4000,                  // EventSource 断线后的重连间隔
    speakPhases: true,              // 进入 tool/waiting/asking/helper/done/failed 时说一句相位台词
    speakCooldownMs: 20000          // 相位台词的抢话冷却（v0.13.6：6s → 20s，AI 状态切换不再密集报话）
                                   // 注：mood 切换（情绪池）仍走全局 speakCoolDownMs(6s)，两者互不影响
  },

  // —— 鼠标转速 -> 头晕（behavior.speedMood 未配置时的兜底阈值）——
  // 灵敏度刻意调钝：要"又快、又久、又远"三条同时满足才算甩晕，随手移动不会误触发。
  dizzy: true,
  dizzySpeedThreshold: 5,         // 速度阈值 px/ms（兜底；配了 behavior.speedMood 时以分档表为准）
  dizzyWindowMs: 150,             // 速度采样窗口：取越长越稳，单次抖动骗不过去
  dizzyHoldMs: 420,               // 持续超阈值多久才算头晕（校验时间，越长越不敏感）
  dizzyMinDistancePx: 120,        // 窗口内累计位移下限（原地小抖不算"甩"）
  dizzyMaxMs: 3000,               // 头晕硬上限，强制恢复
  dizzyRecoverMs: 800,            // 速度回落后多久恢复 idle

  // —— 连点 -> 生气 ——
  angry: true,
  angryClicks: 5,                 // 窗口内点击次数
  angryWindowMs: 4000,            // 连点统计窗口
  angryHoldMs: 2200,              // 生气持续时长（自动回 idle）

  // —— 瞬态表情停留 ——
  successHoldMs: 1400,            // 完成表情停留
  errorHoldMs: 2600,              // 出错表情停留
  previewHoldMs: 3000,            // 双击/面板手动换表情的停留（到点自动回到真实状态，不会卡住）

  // —— 闲置入睡 ——
  idleToSleepAfterMs: 20 * 60 * 1000, // 闲置 20 分钟才入睡（v0.13.6：原来 10 分钟，打盹来得太快）
  wakeOnAnyEvent: true,

  // —— DOM 感知（dsh 改版只改这里；感知不到不影响使用）——
  // 选择器均在 dsh 源码中核实过（packages/client/**）：
  //   working  : AssistantMarkdown.tsx 的 data-streaming、ToolRow.tsx 的 data-tool/data-state、TodoPanel.tsx 的 li[data-status]
  //   thinking : ReasoningRow.tsx 的 data-variant="think" data-state="running"
  //   error    : MessageItem.tsx 的 .turnErrorRow[role=status]、ToolRow 的 data-state="error"
  //   listening: ComposerContentEditable.tsx 的 div[data-composer-input][contenteditable]
  sensors: {
    working: '[data-streaming="true"], [data-tool][data-state="running"], [data-tool][data-state="preparing"], section[data-testid="todo-panel"] li[data-status="in_progress"]',
    thinking: '[data-variant="think"][data-state="running"], [data-reasoning="true"]',
    error: '.turnErrorRow, [data-tool][data-state="error"], [data-turn-error="true"]',
    listening: '[data-composer-input]:focus, [role="textbox"][aria-multiline="true"]:focus'
  },
  sensorDebounceMs: 300,
  sensorSettleMs: 700,            // 从 working 落回后判定 success 的等待

  // —— 主题跟随 ——
  // dsh 在 <body> 上切换 data-ds-dark-theme（ui-layout/theme-presenter.ts），
  // 并把 --dsw-* 设计令牌写成 body 的内联样式，所以气泡/面板直接 var(--dsw-*) 即可自动跟随。
  followTheme: true,
  darkSelector: 'body[data-ds-dark-theme], html[data-ds-theme-source="dark"]',

  // —— 命中区域（透明留白不拦截鼠标）——
  // 由 tools/build-assets.ps1 从 assets/idle.png 的 alpha 剪影自动生成（28 方向射线多边形），
  // 用于 .dgw-hit 的 clip-path；换成自己的立绘后重新生成即可。
  hitPolygon: '48% 10.2%,58.6% 13.8%,65.7% 20.9%,73.5% 24.5%,70.9% 34.7%,66% 41.9%,82.4% 42.5%,80.3% 48.4%,75% 53%,75.1% 58.2%,73.7% 63.7%,69.4% 68.4%,63.8% 73%,59.2% 85.2%,48% 96.6%,37.4% 83.4%,32% 73.3%,28.1% 67.1%,24.5% 62.4%,25.4% 56.6%,28.1% 51.8%,30% 48.4%,28.1% 45%,17.5% 37.3%,21.8% 32.7%,21.6% 23.5%,23.7% 10.5%,35.6% 7.6%',

  // —— 设置面板持久化键 ——
  storageKey: 'dshWhaleGirl.settings',

  debug: false
}
