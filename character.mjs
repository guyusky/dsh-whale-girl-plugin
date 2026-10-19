import { readFileSync } from 'node:fs'
// character.mjs — DeepSeek 鲸鱼娘看板娘 · 角色层
// 每个情绪 = { label, asset, anim, lipsync, transient?, fx?, pool[] }；
// asset 是 assets/ 下的透明 PNG 文件名（tools/build-assets.ps1 生成，全部统一画布对齐）。
// 新增情绪只需在这里加一条 + 放一张同名 PNG；改台词只改 pool，不动引擎。
//
// 台词准则（tools/check-inject.mjs 里有对应的"台词卫生"断言在守）：
//  ① 说人话、角色话：这是鲸鱼娘在说话，不是系统播报 —— 禁止"现在是：XX""当前状态：XX"这类 meta 文本；
//  ② 二次元口吻：语气词（呀/啦/嘛/哦/诶/唔/哼/～）、尾巴/深海/摸鱼/token 等角色化比喻；
//  ③ 不拼状态名：台词里不要出现 label 或 {state}，状态切换靠表情表达，不靠念出来；
//  ④ 短句：单条 ≤ 40 字（气泡最多两行），每条池子尽量 6 条以上，避免重复感。

// 说话口型帧（闭/张交替，仅 lipsync: true 的情绪启用）
export const talking = { closed: 'talk-closed.png', open: 'talk-open.png' }

// 情绪表：id 即 CSS 类 dgw-mood-<id> 与 window.__dshWhaleGirl.setMood(id)
// 台词条目有两种写法（向后兼容）：
//   '普通台词'                                  —— 无条件，权重 1
//   { line:'台词', weight:2, when:{...} }        —— 带权重/条件，条件命中时**优先于**无条件台词
// when 支持的键（引擎侧 whenOk() 实现，自检会校验键名拼写）：
//   night:true             夜里（dialogue.nightStart ~ nightEnd，默认 22~5）
//   hourMin/hourMax        小时窗口（可跨零点）
//   weekday:[6,7]          周几（1=周一 … 7=周日）
//   phase:'tool'           当前事件桥相位（仅桥新鲜时成立）
//   bridge:true|false      是否由事件桥驱动
//   streak:{key:'error',min:2}  连续同类事件次数（语气梯度用）
//   idleFor:120000         已闲置多久
//   minTurns:3             当前回合数下限（事件桥给）
export const moods = {
  idle: {
    label: '待机',
    asset: 'idle.png',
    anim: 'float',
    lipsync: true,
    video: true,          // 中性嘴型：用待机动画（视频不可用时自动退回 idle.png + 浮动动画）
    pool: [
      '唔……要不要一起摸摸鱼呀？',
      '尾巴甩甩～今天也很闲呢',
      '有代码要写吗？我超闲的哦！',
      '诶嘿，我是不是超可爱？',
      '深海的水温刚刚好～',
      '发呆中……理理我嘛',
      '随时待命！鲸鱼也是要待命的',
      '这个角落是我的专属座位♪',
      '唔……要不要摸摸头？就一下哦',
      { line:'夜深了哦，要不要一起早点睡？', weight:3, when:{ night:true } },
      { line:'唔……戳我干嘛，是不想写代码吗？', weight:2, when:{ idleFor:120000 } }
    ]
  },
  listening: {
    label: '等待输入',
    asset: 'idle.png',
    anim: 'lean',
    lipsync: true,
    video: true,
    pool: [
      '我在听哦，说吧说吧～',
      '唔……想好要让我做什么了吗？',
      '敲吧敲吧，我看着呢',
      '准备好就发出来嘛，我等着～',
      '手指动起来了！要写 bug 了吗？',
      '输入框亮着的时候我最精神啦'
    ]
  },
  working: {
    label: '工作中',
    asset: 'idle.png',
    anim: 'work',
    lipsync: true,
    video: true,
    pool: [
      '收到收到！马上开工～',
      '唔……这里要这样写才对',
      '键盘敲得飞起，别打扰我哦',
      '正在努力地……嗯……努力！',
      '这段交给我，稳的！',
      '尾巴摆得这么用力，说明我很认真',
      '诶，我可不是在摸鱼，真的在写',
      '一个 token 一个 token 地写……'
    ]
  },
  thinking: {
    label: '思考',
    asset: 'thinking.png',
    anim: 'think',
    lipsync: false,
    pool: [
      '唔……让我想想哦',
      '这里有点意思诶……',
      '脑内鲸鱼正在转圈圈～',
      '等一下下！我在推理呢',
      '唔……两个方案在打架',
      '嗯……嗯……想到了！……还没',
      '别催别催，思考要时间的嘛',
      { line:'唔……两个方案又打起来了', weight:2, when:{ streak:{ key:'thinking', min:2 } } }
    ]
  },
  success: {
    label: '完成',
    asset: 'happy.png',
    anim: 'pop',
    lipsync: false,
    transient: true,
    fx: 'star',
    pool: [
      '搞定啦～夸我夸我！',
      '完成！尾巴都翘起来了♪',
      '诶嘿，这波很稳吧？',
      '喏，收好啦～记得检查一下哦',
      '完美！不愧是我～',
      '拍拍手！下一个任务呢？',
      '哼，这种小 case 啦',
      { line:'第 {turn} 轮也稳稳拿下啦～', weight:2, when:{ minTurns:3 } }
    ]
  },
  error: {
    label: '出错',
    asset: 'sad.png',
    anim: 'shake',
    lipsync: false,
    transient: true,
    pool: [
      '呜……好像弄坏了什么',
      '唔！报错了……不是我的锅吧？',
      '别慌别慌，我看看哪一步不对劲',
      '尾巴垂下来了……',
      '呜哇，这个错有点凶',
      '再试一次嘛，这次一定行！',
      '对不起嘛……我再看一眼',
      { line:'呜……又出错了，我、我再看看', weight:3, when:{ streak:{ key:'error', min:2 } } },
      { line:'唔……已经连着错好几次了，对不起嘛', weight:3, when:{ streak:{ key:'error', min:3 } } }
    ]
  },
  angry: {
    label: '生气',
    asset: 'angry.png',
    anim: 'anger',
    lipsync: false,
    transient: true,
    fx: 'anger',
    pool: [
      '别戳啦！再戳我就潜水了哦',
      '哼！鲸鱼也是有脾气的！',
      '你你你……尾巴都竖起来了！',
      '不理你了！……好吧还是理你',
      '再点一下试试？哼～',
      '生气了！要摸摸头才能好',
      { line:'你、你今天已经戳我 {streak} 次了哦！', weight:2, when:{ streak:{ key:'angry', min:2 } } }
    ]
  },
  sleep: {
    label: '打盹',
    asset: 'sleep.png',
    anim: 'sleep',
    lipsync: false,
    fx: 'zzz',
    pool: [
      '……Zzz',
      '唔……让我眯一会儿嘛',
      '呼……呼……（尾巴还在慢慢摆）',
      '有事……叫我……（已经睡着了）'
    ]
  },
  dizzy: {
    label: '头晕',
    asset: 'dizzy.png',
    anim: 'dizzy',
    lipsync: false,
    transient: true,
    fx: 'spin',
    pool: [
      '呜……天旋地转的',
      '别晃啦！我要晕过去了～',
      '星星……好多星星在转……',
      '停！我快变成鲸鱼陀螺了！',
      '唔……海洋生物也会晕船的啦'
    ]
  }
}

// 待机小动作：让"待机"不是一模一样地循环。
// 全部是限时瞬态（到点自动回待机）；mood 为 null 时只做身体动作、不换脸（更耐看）。
export const micro = [
  { id: 'glance',  anim: 'think', mood: 'thinking', ms: 1500, fx: null,       line: null },              // 眼睛往上瞟一下
  { id: 'nod',     anim: 'pop',   mood: 'success',  ms: 1100, fx: 'star',     line: null },              // 轻轻开心一下
  { id: 'wag',     anim: 'lean',  mood: null,       ms: 1500, fx: 'note',     line: null },              // 只摆一下尾巴
  { id: 'hum',     anim: 'float', mood: null,       ms: 1400, fx: 'note',     line: '♪ 哼——' },
  { id: 'peek',    anim: 'work',  mood: null,       ms: 1300, fx: 'dot',      line: '……（在看你写代码）' },
  { id: 'stretch', anim: 'pop',   mood: null,       ms: 1500, fx: 'star',     line: '唔——伸个懒腰～' },
  { id: 'yawn',    anim: 'shake', mood: null,       ms: 1600, fx: 'zzz',      line: '哈啊……有点困了', sleepy: true },
  { id: 'curious', anim: 'think', mood: null,       ms: 1400, fx: 'question', line: '唔？' }
]

// 交互台词
export const interact = {
  click: ['呜哇！别突然戳我啦～', '诶嘿，找我有什么事吗？', '尾巴会痒的啦！', '在的在的，我一直都在哦', '唔……又想摸头？', '戳一下就够了嘛～'],
  // 按点击位置分区反应（头 / 身体 / 尾巴）——比"任何地方都同一句"生动得多
  zones: {
    head: ['唔！别摸头啦，会变笨的～', '头发会乱的啦！', '诶嘿……摸头也、也不是不行', '头顶的呆毛不能碰哦'],
    body: ['戳这里有什么用嘛～', '唔……痒痒的', '有事就直说呀，别戳我'],
    tail: ['尾巴会痒的啦！', '呜哇！别碰尾巴！', '尾、尾巴很敏感的……', '再摸尾巴就潜水给你看']
  },
  drag: ['诶诶诶！要带我去哪儿？', '这个位置不错～视野很好', '轻点轻点，别把我扔出去！', '换地方啦？跟着你走～', '唔……这里会不会挡住按钮呀'],
  startle: ['呜哇！吓我一跳！', '诶？！突然靠这么近干嘛', '唔……我的心跳好快'],
  think: ['唔？怎么啦怎么啦～', '诶？一直戳我是什么意思嘛', '嗯？有事就说呀'],
  dizzy: ['呜……别转那么快嘛', '头晕了头晕了……'],
  wake: ['唔……我睡着了吗？', '哈啊……醒啦醒啦，有事吗？', '诶？我刚刚在打盹……被你发现啦']
}

// 全局随机彩蛋
export const random = [
  '我的头发是用 token 染的哦',
  '鲸鱼尾巴其实是数据流变的～',
  '看板娘也是要充电的啦',
  '深海里的代码，都很安静呢',
  '今天也要写很多很多代码呀',
  '你的每一行代码，我都有看着哦',
  '唔……这个 bug 我认识它',
  '要不要摸摸头？就一下哦',
  { line:'深夜的深海，特别安静呢', weight:2, when:{ night:true } },
  { line:'周末也来陪我写代码吗？辛苦啦～', weight:2, when:{ weekday:[6,7] } }
]

// 按时间段的问候（页面载入时问候一次）
export const time = {
  morning: ['早呀～今天也要加油哦！', '新的一天！先来杯咖啡嘛', '早上好～睡醒的鲸鱼最有精神啦'],
  noon: ['中午啦！记得吃饭嘛', '午休一下，下午才有力气写代码呀'],
  afternoon: ['下午茶时间到～要不要歇会儿？', '这个点儿最适合写代码了！'],
  night: ['夜深了哦……注意休息呀', '这么晚还在写吗？陪着你～', '熬夜会掉 token 的哦']
}

// 上下文台词（{workspace} 由 /__mascot/status 注入）
export const context = {
  workspace: ['在 {workspace} 里打工中～', '{workspace} 这个项目交给我吧！', '唔……{workspace} 的代码看起来不错嘛']
}

// 事件桥（v0.3）：宿主 cordis 事件折成的"相位" → 情绪 + 台词。
// 这是**精确状态**（宿主直接告诉你 AI 在干什么），DOM 传感是"猜"，两者互为兜底：
//   桥有帧 → 用桥；桥断流/未启用 → 自动退回 DOM 传感（见 engine.mjs 的 effectiveSensor()）。
// transient 相位不常驻：引擎按对应时长闪一次，然后回到真实状态。
export const bridge = {
  phases: {
    idle: { mood: null },                                    // 空闲 → 走待机动态
    queued: { mood: 'listening' },                            // 有消息排着队
    thinking: { mood: 'thinking' },                           // 模型开始一步（含推理）
    working: { mood: 'working' },                             // 正在输出
    tool: { mood: 'working' },                                // 正在跑工具（台词可点名 {tool}）
    waiting: { mood: 'listening' },                           // 等你在审批里点头
    asking: { mood: 'listening' },                            // 等你回答问题
    helper: { mood: 'thinking' },                             // 子代理在帮忙
    done: { mood: 'success', transient: 'successHoldMs' },    // 回合收尾 → 闪一下开心
    failed: { mood: 'error', transient: 'errorHoldMs' }       // 出错 → 闪一下难过
  },
  // 相位专属台词（进入该相位时说一句，受全局冷却约束；{tool} 会替换成真实工具名）
  lines: {
    queued: ['唔……排队中的消息收到啦', '好多事情呀，我一件件来～'],
    tool: ['唔……正在跑 {tool} 呢，等我一小下～', '用 {tool} 处理中！别催哦', '{tool} 交给我，稳稳的～'],
    waiting: ['唔……要你点个头才行哦', '在等你允许呢，看一眼嘛', '卡在审批这儿啦，帮我按一下～'],
    asking: ['在等你回答我的问题哦～', '唔……这个得你告诉我'],
    helper: ['叫了个小伙伴来帮忙！', '唔……我自己忙不过来，喊了帮手'],
    done: ['搞定啦～夸夸我！', '完成！尾巴都翘起来了♪'],
    failed: ['呜……出问题了', '唔！失败了……别慌，我看看']
  }
}

// 台词语言包：locale/mascot.<lang>.json（键与上面的池子一一对应；缺键自动回落中文）。
// 单独放文件是为了"加一门语言 = 加一个 JSON"，不用改代码；英文包同时充当 i18n 样例。
function loadLocale(lang) {
  try {
    const url = new URL(`./locale/mascot.${lang}.json`, import.meta.url)
    const data = JSON.parse(readFileSync(url, 'utf8'))
    for (const key of Object.keys(data)) if (key.startsWith('_')) delete data[key]  // 下划线字段是给维护者的注释
    return data
  } catch {
    return null
  }
}

/** 可用语言包（中文是内置兜底，不在表里）。 */
export const locales = (() => {
  const out = {}
  for (const lang of ['en']) {
    const pack = loadLocale(lang)
    if (pack) out[lang] = pack
  }
  return out
})()

// 休闲动作（动态待机动作）：只在"真待机"时按间隔抽一个播放，随时让位于操作与 AI 状态。
// kind 决定姿态曲线（引擎 actPoseAt 实现）；pose 是该动作的参数；when 决定位置条件。
// needsArt=true 的动作要等素材（artReady）才会被抽到——它是"需求登记"，不是死配置。
export const acts = [
  {
    id: 'jog', label: '原地跑步', kind: 'jog', weight: 3, ms: 3200,
    when: { notEdge: true },              // 贴边时交给扒墙动作
    pose: { hz: 2.6, amp: 6, tiltDeg: 3, pitchDeg: 2 },
    fx: 'note', line: '唔……跑一跑暖暖身子！'
  },
  {
    id: 'peekEdge', label: '扒墙偷看', kind: 'peek', weight: 5, ms: 4200,
    when: { anySide: true },              // 只有贴住左右边（把边界当墙）才做
    // 素材：T5 三帧（2026-10-16 交付，v3）。姿势由素材给，运动由引擎补——
    // 探出位移 / 倾斜 / 停顿 / 镜像是引擎的事（见开发文档 §23.7b）
    frames: ['act-peek-01.png', 'act-peek-02.png', 'act-peek-03.png'],
    frameMs: 700,                          // 每帧停留（播完停在第 3 帧）
    artReady: true,
    // sustain:'edge' = 状态保持：只要还贴在边缘就一直"摸墙偷看"，离开边缘才结束
    sustain: 'edge',
    // 保持态里的"眼睛活着"（v0.15.0）：这三帧是静帧，播完停在第 3 帧就一直不动了
    //（待机态用的是 idle.webm 视频，眼珠逐帧在动），所以这里让引擎每隔几秒把画面换成
    // act-peek-03-blink.png（闭眼帧）约 130ms —— 就是一次真眨眼，眼睛"会动"了。
    // 闭眼帧由 tools/build-eye-life.ps1 从第 3 帧生成（同画布、同对齐，所以直接换 src 不会错位）。
    eyeLife: {
      base: 'act-peek-03.png',             // 保持态停住的那一帧（闭眼帧的眼位以它为准）
      blink: 'act-peek-03-blink.png',      // 闭眼帧（素材不在时不眨眼，其余照常）
      blinkMs: 130,                        // 闭眼停多久（真人眨眼 100~150ms）
      gapMs: [2200, 6200]                  // 两次眨眼的间隔范围（随机，别像节拍器）
    },
    // hideFrac：身体有多大比例藏在"墙"（视口边界）之外；probePx：探头的往复幅度
    // swayDeg/swayHz：保持态里的慢速左右微摆（头带着眼睛一起轻轻晃，像待机那样"活着"）
    pose: { hz: 0.35, hideFrac: 0.45, probePx: 16, tiltDeg: 4, swayDeg: 2.4, swayHz: 0.075 },
    fx: 'question', line: '……（扒着边边偷看你）'
  },
  {
    id: 'lieLook', label: '趴着看', kind: 'lie', weight: 4, ms: 4000,
    when: { bottom: true },               // 贴住底边时趴着看
    pose: { hz: 0.45, sinkPx: 10, amp: 2, tiltDeg: 2, pitchDeg: 5 },
    fx: 'note', line: '趴一会儿……你继续写嘛'
  },
  {
    id: 'fan', label: '掏折扇煽风', kind: 'fan', weight: 4, ms: 3400,
    needsArt: true, artReady: false,      // 扇子是"凭空多出来的物体"：程序化做不出来，等素材
    when: { notEdge: true, notBottom: true },
    pose: { hz: 1.4, tiltDeg: 4, armPx: 3 },
    fx: 'star', line: '热的话……要不要也给你扇扇？'
  }
]

export default { talking, moods, micro, interact, random, time, context, bridge, locales, acts }
