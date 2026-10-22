// tools/check-inject.mjs — 交付前自检（node tools/check-inject.mjs）
// 1) 引擎能渲染出注入片段，占位符已替换、无残留 token
// 2) 注入的内联脚本语法可解析（new Function）
// 3) 所有情绪素材文件存在，且 character.mjs 的 asset 名字与实际文件一致
// 4) 说话口型帧与待机动画存在
// 5) backend 的素材白名单/路径穿越防护正确
// 6) 素材路由前缀与 index.js 注入的前缀一致
import { readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import character, { moods, micro, talking, interact, random, time, context } from '../character.mjs'
import { renderInject, renderCompact, renderClientScript } from '../engine.mjs'
import { resolveAsset, ASSET_PREFIX, STATUS_PATH, ENGINE_PATH, createEngineRoute, readIfNoneMatch, KNOWN_ASSETS } from '../backend.mjs'
import { readFileSync } from 'node:fs'

const here = fileURLToPath(new URL('.', import.meta.url))
const assetsDir = join(here, '..', 'assets')
const failures = []
const notes = []

/** 造一份最小可用配置（给 buildInject 的纯函数测试用）。 */
function cfgForTest() {
  return {
    zIndex: 8000, hitPolygon: '0% 0%', idleFadeMs: 220, mountTarget: 'body',
    defaultPos: { right: 24, bottom: 18 }, imgHeight: 200, defaultScale: 1, minScale: 0.6, maxScale: 2,
    defaultOpacity: 1, idleMotion: 'video', idleVideo: 'idle.webm', videoIdlePauseMs: 8000, talkFps: 5,
    bubbleDurationMs: 4200, speakCoolDownMs: 6000, idleSpeakIntervalMs: 45000, recentPoolSize: 8,
    followCursor: true, lookSmooth: 0.08, lookMaxOffset: 8, dizzy: true, dizzySpeedThreshold: 3.5,
    dizzyHoldMs: 260, dizzyMaxMs: 3000, dizzyRecoverMs: 600, angry: true, angryClicks: 5,
    angryWindowMs: 4000, angryHoldMs: 2200, successHoldMs: 1400, errorHoldMs: 2600, previewHoldMs: 3000,
    idleToSleepAfterMs: 600000, wakeOnAnyEvent: true, sensors: {}, sensorDebounceMs: 300, sensorSettleMs: 700,
    followTheme: true, darkSelector: 'body[data-ds-dark-theme]', storageKey: 'k', debug: false
  }
}

function check(ok, label, detail) {
  if (ok) notes.push(`  ok   ${label}`)
  else failures.push(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

// ---- 1) 注入片段 ----
const html = renderInject(`${ASSET_PREFIX}/`, '9.9.9')
check(html.includes('dsh-whale-girl-style'), '注入片段含样式块')
const PLACEHOLDERS = ['__DGW_CSS__', '__DGW_CFG__', '__DGW_CHAR__', '__DGW_ASSET_BASE__', '__DGW_ASSET_VER__', '__DGW_PROLOGUE__']
const hasPlaceholder = (text) => PLACEHOLDERS.some((tok) => text.includes(tok))
check(!hasPlaceholder(html), '占位符已全部替换')
check(!html.includes('${'), '模板里没有漏掉的插值')
check(html.includes(`${ASSET_PREFIX}/`), '素材前缀已注入')
check(html.includes('9.9.9'), '版本号已注入（cache-busting）')

// ---- 1b) 外链注入形态（引擎改资产文件，§20.4）----
{
  const compact = renderCompact(`${ASSET_PREFIX}/`, '9.9.9', ENGINE_PATH)
  const client = renderClientScript(`${ASSET_PREFIX}/`, '9.9.9')
  check(!hasPlaceholder(compact), '外链形态没有残留占位符')
  check(compact.length < html.length * 0.35, `外链形态显著更小（${compact.length} vs 内联 ${html.length} 字节）`)
  check(!compact.includes('pickFrom'), '外链形态里没有引擎代码（只在单独的文件里）')
  check(compact.includes('window.__DGW_DATA__'), '外链形态带数据脚本')
  check(/<script src="\/__mascot\/engine\.js\?v=9\.9\.9">/.test(compact), '引擎脚本挂在 /__mascot/engine.js（站内绝对路径，不在素材目录下）')
  check(!/src="[^"]*\/asset\/__mascot/.test(compact), '不会把绝对路径拼到素材前缀后面（事件桥 URL 同款坑）')
  check(compact.includes('dsh-whale-girl-style') && compact.includes('dgw-root'), '外链形态仍然自带样式（不能等脚本加载才好看）')
  check(client.includes('pickFrom') && client.includes('window.__DGW_DATA__'), '引擎脚本含引擎代码且从数据引导读取配置')
  check(!client.includes('__DGW_CFG__') && !client.includes('__DGW_CHAR__'), '引擎脚本不含配置/角色字面量（数据在页面里）')
  check(!client.includes('<style'), '引擎脚本不含样式（样式留在页面里，避免无样式闪烁）')
  check(!client.includes(`${ASSET_PREFIX}`) || client.includes('DATA.assetBase'), '素材前缀来自运行时数据（可热更新）')
  try {
    new Function(client)
    check(true, '引擎脚本语法正确（可被浏览器直接执行）')
  } catch (err) {
    check(false, '引擎脚本语法正确（可被浏览器直接执行）', err.message)
  }
}

// buildInject 是纯函数（index.js 热更新靠它重新求值）
{
  const { buildInject } = await import('../engine.mjs')
  const fakeCfg = { ...cfgForTest(), zIndex: 1234, hitPolygon: '0% 0%,100% 0%,100% 100%', idleFadeMs: 9 }
  const fakeChr = { talking: { closed: 'a.png', open: 'b.png' }, moods: { idle: { label: '甲', asset: 'i.png', pool: [] } }, interact: { click: [], drag: [] }, random: [], time: {}, context: {} }
  const out = buildInject(fakeCfg, fakeChr, '/__x__/', '7.7.7')
  check(out.includes('z-index:1234'), 'buildInject 用传入的配置渲染 CSS')
  check(out.includes('polygon(0% 0%,100% 0%,100% 100%)'), 'buildInject 用传入的 hitPolygon')
  check(out.includes('"zIndex":1234'), 'buildInject 把配置内联进脚本')
  check(out.includes('甲'), 'buildInject 把角色数据内联进脚本')
  check(out.includes('/__x__/') && out.includes('7.7.7'), 'buildInject 注入素材前缀与版本')
}

const m = /<script>([\s\S]*?)<\/script>/.exec(html)
check(m !== null, '注入片段含内联脚本')
check(!/[A-Z][A-Z_]{3,}TOKEN/.test(html), '模板占位符没有泄漏进产物（反引号/插值写错会在这里暴露）')

// 动画健全性：每个情绪的 anim 都必须在 ANIM 表里，且表里引用的 keyframes 都真实存在。
// 这条能挡住"新增情绪忘了配动画 → 一张死图"这类问题。
{
  const animTable = /var ANIM=\{([\s\S]*?)\n  \};/.exec(html)
  check(animTable !== null, 'ANIM 动画表存在')
  if (animTable) {
    const table = animTable[1]
    const keys = new Set([...table.matchAll(/(\w+)\s*:\s*'/g)].map((x) => x[1]))
    const specs = [...table.matchAll(/:\s*'([^']+)'/g)].map((x) => x[1])
    const usedFrames = new Set(specs.flatMap((s) => [...s.matchAll(/(dgw-[a-z-]+)\s/g)].map((x) => x[1])))
    const declaredFrames = new Set([...html.matchAll(/@keyframes\s+(dgw-[a-z-]+)\s*\{/g)].map((x) => x[1]))
    for (const mood of Object.values(moods)) {
      check(keys.has(mood.anim), `情绪动画 ${mood.anim} 在 ANIM 表里`)
    }
    for (const frame of usedFrames) {
      check(declaredFrames.has(frame), `keyframes ${frame} 已在样式里定义`)
    }
    check(keys.has('float'), 'ANIM 有 float 兜底（未知动画名退回它，不会静帧）')
    check(table.includes('dgw-breathe'), '一次性动画后面接了呼吸（播完不会变成死图）')
  }
}
if (m) {
  try {
    // 只做语法解析，不执行
    new Function(m[1].replace(/<\/script>$/, ''))
    notes.push('  ok   内联脚本语法可解析')
  } catch (err) {
    failures.push(`  FAIL 内联脚本语法错误 — ${err.message}`)
  }
  check(m[1].includes('__dshWhaleGirl'), '调试钩子 window.__dshWhaleGirl 存在')
  check(m[1].includes('clip-path') || m[1].includes('dgw-hit'), '命中层（剪影裁切）存在')
}

// ---- 2) 样式与脚本的成对性 ----
check((html.match(/<style/g) || []).length === 1, '只有一份 <style>')
check((html.match(/<script>/g) || []).length === 1, '只有一份 <script>')

// ---- 3) 素材文件 ----
const onDisk = new Set(readdirSync(assetsDir))
const wanted = new Set()
for (const [id, mood] of Object.entries(moods)) {
  wanted.add(mood.asset)
  check(onDisk.has(mood.asset), `情绪 ${id} 的素材 ${mood.asset} 存在`)
}
check(onDisk.has(talking.closed), `口型帧 ${talking.closed} 存在`)
check(onDisk.has(talking.open), `口型帧 ${talking.open} 存在`)
wanted.add(talking.closed)
wanted.add(talking.open)
const cfg = (await import('../mascot.config.mjs')).default
check(onDisk.has(cfg.idleVideo), `待机动画 ${cfg.idleVideo} 存在`)
if (cfg.sound && cfg.sound.bgm) {
  wanted.add(cfg.sound.bgm)
  check(onDisk.has(cfg.sound.bgm), `音效素材 ${cfg.sound.bgm} 存在`)
  check(resolveAsset(cfg.sound.bgm) !== null, `素材路由放行音效 ${cfg.sound.bgm}`)
}

// 素材都在放行规则内（否则路由 404）
for (const name of wanted) {
  check(resolveAsset(name) !== null, `素材路由放行 ${name}`)
}
check(resolveAsset(cfg.idleVideo) !== null, `素材路由放行 ${cfg.idleVideo}`)

// 未被引用的多余文件（提示，不算失败）
for (const name of onDisk) {
  if (!wanted.has(name) && name !== cfg.idleVideo) notes.push(`  note 未使用的素材文件：${name}`)
}

// ---- 4) 体积 ----
let total = 0
for (const name of onDisk) total += statSync(join(assetsDir, name)).size
const mb = total / 1024 / 1024
check(mb < 6, `素材总体积 ${mb.toFixed(2)} MB 合理（< 6MB）`)

// ---- 5) 路径穿越防护 ----
const attacks = ['../package.json', '..%2Fpackage.json', 'a/../../index.js', 'C:\\Windows\\win.ini', 'idle.png/../index.js', '', '.', 'idle.png ', 'engine.mjs', 'index.js', 'package.json', '.hidden.png', 'tools/build-assets.ps1']
for (const a of attacks) {
  check(resolveAsset(a) === null, `拒绝非法素材路径：${JSON.stringify(a)}`)
}
check(resolveAsset('idle.png') !== null, '接受合法素材路径 idle.png')

// ---- 6) 前缀一致性 ----
check(ASSET_PREFIX === '/__mascot/asset', '素材路由前缀为 /__mascot/asset')
check(STATUS_PATH === '/__mascot/status', '状态路由为 /__mascot/status')
check(/^\/__mascot\//.test(ASSET_PREFIX) && /^\/__mascot\//.test(STATUS_PATH), '两个路由都在 /__mascot/ 命名空间下')

// ---- 7) 清单一致性 ----
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json 声明 dsh.bundle.patch')
check(existsSync(join(here, '..', 'cordis.patch.yml')), 'cordis.patch.yml 存在')
check(existsSync(join(here, '..', 'icon.png')), 'icon.png 存在（显示清单要求）')
check(statSync(join(here, '..', 'icon.png')).size <= 256 * 1024, 'icon.png ≤ 256KiB')
for (const f of ['index.js', 'engine.mjs', 'character.mjs', 'mascot.config.mjs', 'backend.mjs']) {
  check(pkg.files.includes(f), `files 列表包含 ${f}`)
}

// ---- 7) Host 插件装配（用假 ctx 真正跑一遍 apply）----
{
  const plugin = await import('../index.js')
  check(plugin.name === 'dsh-whale-girl-plugin', 'index.js 导出插件名')
  check(typeof plugin.apply === 'function', 'index.js 导出 apply(ctx)')

  const taps = []
  const routes = []
  let effectCleanups = 0
  let effectBody = null
  const mockWebServer = {
    tapIndex(fn) { taps.push(fn); return () => { const i = taps.indexOf(fn); if (i >= 0) taps.splice(i, 1) } },
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) } }
  }
  const mockCtx = {
    /** 事件桥会挂到插件自己的 ctx 上：这里记录订阅了哪些事件、disposer 是否被调用 */
    onCalls: [],
    onDisposed: 0,
    on(name, listener) {
      this.onCalls.push([name, listener])
      return () => { this.onDisposed += 1 }
    },
    inject(services, cb) {
      check(Array.isArray(services) && services.includes('webServer'), 'apply 里 inject 声明了 webServer')
      cb({ webServer: mockWebServer, effect(body) { effectBody = body; effectCleanups++ ; return () => {} } })
    }
  }
  // 拦一下定时器，验证热更新轮询被注册、并且 disposer 会清掉它（否则热重载会越挂越多）
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  let watchTimer = null
  const clearedTimers = []
  globalThis.setInterval = (fn, ms) => { watchTimer = { fn, ms }; return watchTimer }
  globalThis.clearInterval = (id) => { clearedTimers.push(id) }
  try {
    plugin.apply(mockCtx)
    const dispose = typeof effectBody === 'function' ? effectBody() : null
    check(effectCleanups === 1, '一切注册都在一个 ctx.effect 内（可清理）')
    check(watchTimer !== null && watchTimer.ms === 2000, '注册了 2s 的源码热更新轮询')
    check(taps.length === 1, 'tapIndex 注册了一次')
    check(routes.length === 4, '注册了四个路由（asset + status + events + engine.js）')
    check(routes.some((r) => r.kind === 'prefix' && r.path === '/__mascot/asset'), 'asset 路由为 prefix /__mascot/asset')
    check(routes.some((r) => r.kind === 'exact' && r.path === '/__mascot/status'), 'status 路由为 exact /__mascot/status')
    check(routes.some((r) => r.kind === 'exact' && r.path === '/__mascot/events'), 'events 路由为 exact /__mascot/events（事件桥 SSE）')
    const engineRoute = routes.find((r) => r.path === '/__mascot/engine.js')
    check(!!engineRoute, 'engine.js 路由已注册（外链注入形态的前提）')

    // 外链引擎路由必须指向"当前模块"：进程启动时 import 进来的那份 renderClientScript 是死的，
    // 引擎热更新后还用它 → hotReloads 涨了、刷新页面却仍是旧代码（v0.15.1 修）
    const indexSource = readFileSync(join(here, '..', 'index.js'), 'utf8')
    check(/let activeEngine = \{ renderClientScript \}/.test(indexSource), 'index.js 维护"当前引擎模块"引用（activeEngine）')
    check(/render: \(\) => activeEngine\.renderClientScript\(ASSET_BASE, VERSION\)/.test(indexSource), 'engine.js 路由用当前引擎模块现场渲染（热更新后刷新即生效）')
    check(/activeEngine = engMod/.test(indexSource), '热更新成功后把 activeEngine 换成新 import 的模块')

    // 宿主事件订阅：持续态 + 一次性 + waterfall（waterfall 必须把链交回去，否则会打断 dsh 决策）
    const subscribed = mockCtx.onCalls.map(([name]) => name)
    for (const name of ['agent/status', 'agent/assistant-stream', 'tools/pre-execute', 'tools/result',
      'agent/turn-stopping', 'agent/error', 'approval/request', 'user-questions/request',
      'subagent/start', 'subagent/end', 'agent/inbox/inserted', 'agent/inbox/claimed']) {
      check(subscribed.includes(name), `订阅了宿主事件 ${name}`)
    }
    let nextCalled = 0
    for (const [name, listener] of mockCtx.onCalls) {
      if (name === 'tools/pre-execute' || name === 'approval/request' || name === 'user-questions/request') {
        check(listener({}, () => { nextCalled += 1 }) !== undefined ||
              nextCalled > 0, `waterfall 事件 ${name} 会把链交回去（return next()）`)
      }
    }
    check(nextCalled === 3, `三个 waterfall 监听都调用了 next()（实际 ${nextCalled}）`)

    // 真跑一次 index.html 注入，验证拼接位置与幂等性
    const sample = '<!doctype html><html><head><title>dsh</title></head><body><div id="root"></div></body></html>'
    const out = taps[0](sample)
    check(out.indexOf('dsh-whale-girl-style') < out.indexOf('</head>'), '注入片段落在 </head> 之前')
    check(out.startsWith('<!doctype html>'), '原有 HTML 前缀未被破坏')
    check(out.includes('/__mascot/asset/'), '注入片段带素材前缀')
    check(taps[0]('<html><body>x</body></html>').endsWith('</script>\n'), '没有 </head> 时退化为追加')

    // status 的自检信息（浏览器之外确认"插件到底装上了没"）
    const statusRoute = routes.find((r) => r.path === '/__mascot/status')
    check(typeof statusRoute.handler === 'function', 'status 路由有 handler')
    check(typeof dispose === 'function', 'effect 返回 disposer')
    if (typeof dispose === 'function') dispose()
    check(taps.length === 0 && routes.length === 0, 'disposer 清理了 tapIndex 与全部路由（热重载不重复注册）')
    check(clearedTimers.length === 1 && clearedTimers[0] === watchTimer, 'disposer 清掉了热更新轮询')
    // 引擎脚本路由：ETag 命中 304 / 内容类型 / 方法限制（外链形态的缓存基础）
    {
      let source = renderClientScript('/__mascot/asset/', '1.0.0')
      const route = createEngineRoute({ path: ENGINE_PATH, render: () => source })
      const call = (headers = {}, method = 'GET') => {
        const out = { headers: null, status: 0, ended: false, body: null }
        route.handler({ method, headers, url: ENGINE_PATH }, {
          writeHead(status, h) { out.status = status; out.headers = h },
          end(body) { out.ended = true; if (body) out.body = body }
        })
        return out
      }
      const first = call()
      check(first.status === 200 && String(first.headers['Content-Type']).startsWith('application/javascript'), 'engine.js 返回 JS 内容类型')
      check(String(first.headers['Cache-Control']).includes('no-cache'), 'engine.js 允许缓存但每次回源校验（热更新后立刻生效）')
      const etag = first.headers.ETag
      check(typeof etag === 'string' && etag.length > 5, 'engine.js 带 ETag')
      check(call({ 'if-none-match': etag }).status === 304, 'ETag 命中时返回 304（浏览器用本地缓存）')
      // 真实宿主的 req 形态不止一种（实测只读 req.headers 会拿不到 → 304 失效）
      check(readIfNoneMatch({ headers: { 'if-none-match': etag } }) === etag, 'Node 形态：req.headers 小写键')
      check(readIfNoneMatch({ headers: { 'If-None-Match': etag } }) === etag, 'Express 形态：大写键')
      check(readIfNoneMatch({ raw: { headers: { 'if-none-match': etag } } }) === etag, '包装形态：req.raw.headers')
      check(readIfNoneMatch({ header: (n) => (n === 'if-none-match' ? etag : undefined) }) === etag, 'koa 形态：req.header()')
      check(readIfNoneMatch({ headers: { get: (n) => (n === 'if-none-match' ? etag : undefined) } }) === etag, 'Headers 实例形态：headers.get()')
      check(readIfNoneMatch({}) === undefined, '没有该头时返回 undefined（不会误判成 304）')
      source = source + '\n// changed'
      check(call({ 'if-none-match': etag }).status === 200, '引擎内容变了就不再 304（自动取新版）')
      check(call({}, 'POST').status === 405, 'engine.js 只接受 GET/HEAD')
      check(call({}, 'HEAD').status === 200, 'HEAD 可用（不带 body）')
    }
    check(mockCtx.onDisposed === mockCtx.onCalls.length, `disposer 退订了全部宿主事件（${mockCtx.onDisposed}/${mockCtx.onCalls.length}）`)
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
}

// ---- 7b) 事件桥：相位归约器（纯函数，能单测）+ SSE 帧协议 ----
{
  const { createActivityBridge, createEventRoute, PHASES, TRANSIENT_PHASES } =
    await import('../bridge.mjs')
  const bridge = createActivityBridge({ doneHoldMs: 20, failHoldMs: 20 })

  check(bridge.snapshot().phase === 'idle', '事件桥初始相位为 idle')

  bridge.handle('agent/status', { status: 'running' })
  check(bridge.snapshot().phase === 'thinking' && bridge.snapshot().running === 1, 'agent/status running → thinking')

  bridge.handle('tools/pre-execute', { exec: { name: 'pwsh' } })
  check(bridge.snapshot().phase === 'tool' && bridge.snapshot().tool === 'pwsh', 'tools/pre-execute → tool + 工具名')

  bridge.handle('tools/result', { exec: { name: 'pwsh' } })
  check(bridge.snapshot().phase === 'thinking', 'tools/result → 回到 thinking（回合还在跑）')

  bridge.handle('agent/assistant-stream', { frame: { type: 'chunk' } })
  check(bridge.snapshot().phase === 'working', 'assistant-stream chunk → working')

  bridge.handle('subagent/start', {})
  check(bridge.snapshot().phase === 'helper' && bridge.snapshot().helpers === 1, 'subagent/start → helper')
  bridge.handle('subagent/end', {})
  check(bridge.snapshot().helpers === 0 && bridge.snapshot().phase === 'working', 'subagent/end → 回到 working')

  bridge.handle('approval/request', {})
  check(bridge.snapshot().phase === 'waiting', 'approval/request → waiting')
  bridge.handle('user-questions/request', {})
  check(bridge.snapshot().phase === 'asking', 'user-questions/request → asking')

  bridge.handle('agent/error', { error: { message: 'boom' } })
  check(bridge.snapshot().phase === 'failed' && bridge.snapshot().detail === 'boom', 'agent/error → failed + detail')

  bridge.handle('agent/turn-stopping', { turn: 7 })
  check(bridge.snapshot().phase === 'done' && bridge.snapshot().turn === 7, 'agent/turn-stopping → done')

  bridge.handle('agent/status', { status: 'idle' })
  check(bridge.snapshot().running === 0, 'agent/status idle → running 归零')
  check(bridge.snapshot().phase === 'done', 'done 相位不会被 idle 立刻打断（保留庆祝帧）')

  // 相位全集覆盖：宿主能产出的每个相位，引擎侧都要有 mood 映射
  const character = (await import('../character.mjs')).default
  for (const phase of PHASES) {
    const mapping = character.bridge?.phases?.[phase]
    check(mapping !== undefined, `角色层覆盖相位 ${phase}`)
    check(mapping.mood === null || Object.keys(moods).includes(mapping.mood), `相位 ${phase} 的 mood 合法（${mapping.mood}）`)
    if (TRANSIENT_PHASES.includes(phase)) {
      check(typeof mapping.transient === 'string' && mapping.transient.length > 0, `瞬时相位 ${phase} 声明了停留时长字段`)
    }
  }
  for (const key of Object.keys(character.bridge?.lines || {})) {
    check(PHASES.includes(key), `事件桥台词分组 ${key} 是合法相位`)
  }

  // SSE 协议：首帧快照 + 变化推帧 + 断开退订
  const route = createEventRoute(bridge, { path: '/__mascot/events', pingMs: 10 ** 7 })
  check(route.kind === 'exact' && route.path === '/__mascot/events', 'SSE 路由形态正确')
  const writes = []
  let ended = false
  const listeners = {}
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    write(chunk) { writes.push(String(chunk)) },
    end() { ended = true },
    on(ev, fn) { listeners[ev] = fn }
  }
  const req = { method: 'GET', on(ev, fn) { listeners[`req:${ev}`] = fn } }
  route.handler(req, res)
  check(res.status === 200 && String(res.headers['Content-Type']).startsWith('text/event-stream'), 'SSE 响应头正确')
  check(writes.some((w) => w.startsWith('retry:')), 'SSE 首帧带 retry（断线重连节奏）')
  check(writes.some((w) => w.startsWith('data: ') && w.includes('"phase"')), 'SSE 首帧是相位快照')
  const before = writes.length
  bridge.force('working')
  check(writes.length > before, '相位变化会推新帧')
  check(bridge.state.counters['agent/status'] === 2, '事件命中次数被记录（诊断用）')
  listeners['req:close']?.()
  check(ended === true, '客户端断开会结束响应')
  const afterClose = writes.length
  bridge.force('idle')
  check(writes.length === afterClose, '断开后不再写帧（订阅已退订）')
}

// ---- 8) 行为层健全性：状态必须"跟着操作智能切换"，且任何瞬态都能回到待机 ----
{
  const cfg = (await import('../mascot.config.mjs')).default
  const b = cfg.behavior
  check(b !== undefined && typeof b === 'object', '配置里有 behavior 行为层')
  const ids = Object.keys(moods)

  // 待机小动作必须合法（否则待机时会跳到不存在的情绪/动画）
  check(Array.isArray(micro) && micro.length > 0, 'character.mjs 有待机小动作表 micro')
  for (const m of micro) {
    check(typeof m.id === 'string' && m.id.length > 0, `小动作有 id：${m.id}`)
    check(m.mood == null || ids.includes(m.mood), `小动作 ${m.id} 的 mood 合法（${m.mood}）`)
    check(typeof m.ms === 'number' && m.ms > 0, `小动作 ${m.id} 有时长`)
    check(m.line == null || typeof m.line === 'string', `小动作 ${m.id} 的台词是字符串`)
  }
  const microIds = micro.map((m) => m.id)
  check(new Set(microIds).size === microIds.length, '待机小动作 id 不重复')
  check(micro.some((m) => m.mood), '小动作里有"换脸"型（更生动）')
  check(micro.some((m) => m.mood == null), '小动作里有"只动身体"型（不换脸，更耐看）')
  check(micro.some((m) => m.sleepy === true), '有"打哈欠"型小动作（入睡有铺垫）')

  // 操作型瞬态：每一类都必须有明确停留时长（到点必回待机）
  for (const key of ['dizzy', 'angry', 'think', 'poke']) {
    check(typeof b.transientMs?.[key] === 'number' && b.transientMs[key] > 0, `瞬态 ${key} 有停留时长（${b.transientMs?.[key]}ms）`)
  }
  check(ids.includes(b.dizzyMood), `头晕表情 dizzyMood 合法（${b.dizzyMood}）`)
  const tiers = b.speedMood
  check(Array.isArray(tiers) && tiers.length >= 2, '配了 speedMood 分档（鼠标速度 → 情绪）')
  let prevMax = -1
  let monotonic = true
  for (const t of tiers) {
    if (!(t.max > prevMax)) monotonic = false
    prevMax = t.max
    check(t.mood == null || ids.includes(t.mood), `速度档 mood 合法（${t.mood}）`)
    check(typeof t.look !== 'number' || t.look > 0, `速度档 look 系数合法（${t.look}）`)
  }
  check(monotonic, 'speedMood 档位阈值递增（不会出现永远命中不到/顺序反了的档）')
  check(tiers.some((t) => t.mood != null), 'speedMood 有"会换表情"的档（甩太快会头晕）')

  check(b.typewriterCps >= 0, '气泡逐字速度合法（0 = 直接整句）')
  check(b.hoverScale >= 1, '悬停放大系数 >= 1')
  check(b.dragTiltMaxDeg >= 0, '拖拽倾斜角度合法')
  check(b.clickThinkAt > 0 && b.clickAngryAt > b.clickThinkAt, '点击分档递增（咦？→ 生气）')
  check(b.idleMicroMinMs > 0 && b.idleMicroMaxMs >= b.idleMicroMinMs, '待机小动作间隔区间合法')

  // 头晕灵敏度下限：不允许再调回"随手动一下就晕"
  // 命中某档的条件是 v <= tier.max，所以"会换表情的那一档"的实际触发阈值是它**前一档**的 max
  const dizzyIdx = tiers.findIndex((t) => t.mood != null)
  const triggerAt = dizzyIdx > 0 ? tiers[dizzyIdx - 1].max : (dizzyIdx === 0 ? tiers[0].max : Infinity)
  check(triggerAt >= 4, `头晕触发阈值不低于 4px/ms（当前 >${triggerAt}px/ms）——防止随手移动就误触发`)
  check(cfg.dizzyHoldMs >= 350, `头晕要求持续时长不低于 350ms（当前 ${cfg.dizzyHoldMs}ms）`)
  check(typeof cfg.dizzyMinDistancePx === 'number' && cfg.dizzyMinDistancePx >= 80, `头晕要求窗口内最小位移 >= 80px（当前 ${cfg.dizzyMinDistancePx}px）`)
  check(typeof cfg.dizzyWindowMs === 'number' && cfg.dizzyWindowMs >= 120, `速度采样窗口 >= 120ms（当前 ${cfg.dizzyWindowMs}ms）`)

  // 设置面板可拖拽 + 位置记忆
  check(html.includes('bindPanelDrag'), '注入脚本里有面板拖拽绑定')
  check(html.includes('dgw-panel-grip') && html.includes('cursor:move'), '面板表头有拖拽抓手与 cursor:move')
  check(html.includes('state.panelPos') && html.includes('panelPos:state.panelPos'), '面板位置写入设置持久化')
  check(html.includes('clampPanel'), '窗口缩放时面板位置会被夹回可视区')
  check(html.includes('applyPanelPos'), '面板打开时应用记忆位置（双击表头可复位）')

  // 台词卫生：说角色话，不说"系统播报"话
  {
    const pools = []
    // 递归收集：interact.zones 之类的嵌套分组也要扫到（否则新加的台词会漏检）
    const collect = (prefix, value) => {
      if (Array.isArray(value)) { for (const e of value) { const line = (typeof e === 'string') ? e : (e && e.line); if (line) pools.push([prefix, line]) } }
      else if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) collect(`${prefix}.${k}`, v) }
    }
    for (const [id, mood] of Object.entries(moods)) collect(`${id}.pool`, mood.pool)
    collect('interact', interact)
    collect('random', random)
    collect('time', time)
    collect('context', context)
    collect('bridge.lines', character.bridge?.lines)
    for (const m of micro) if (m.line) pools.push([`micro.${m.id}`, m.line])

    check(pools.length >= 80, `台词总量足够（${pools.length} 条，池子大才不容易重复）`)

    const metaWords = ['现在是', '当前状态', '状态：', '状态:', '测试台词', 'debug', 'undefined', 'null']
    const badMeta = pools.filter(([, line]) => metaWords.some((w) => line.includes(w)))
    check(badMeta.length === 0, '台词里没有"系统播报"式 meta 文本（如"现在是：完成"）', badMeta.map(([g, l]) => `${g}: ${l}`).join(' / '))

    const badStateVar = pools.filter(([, line]) => line.includes('{state}'))
    check(badStateVar.length === 0, '台词不插值 {state}（那等于把状态名念出来）', badStateVar.map(([g, l]) => `${g}: ${l}`).join(' / '))

    const badTick = pools.filter(([, line]) => line.includes('`'))
    check(badTick.length === 0, '台词里没有反引号（气泡是纯文本，会原样显示）', badTick.map(([g, l]) => `${g}: ${l}`).join(' / '))

    const tooLong = pools.filter(([, line]) => line.length > 40)
    check(tooLong.length === 0, '台词都不超过 40 字（气泡最多两行）', tooLong.map(([g, l]) => `${g}: ${l.length}字`).join(' / '))

    for (const [id, mood] of Object.entries(moods)) {
      check((mood.pool || []).length >= 4, `情绪 ${id} 的台词池 >= 4 条（当前 ${(mood.pool || []).length}）`)
    }
    for (const group of ['click', 'drag', 'think', 'wake']) {
      check((interact?.[group] || []).length > 0, `interact.${group} 台词池非空`)
    }
    // 引擎侧：不许再拼"现在是 XX"这类报幕，也不许把 label 当台词
    check(!html.includes('现在是'), '注入脚本里不存在"现在是"报幕')
    check(!/speak\([^)]*\.label/.test(html), '注入脚本里没有把情绪 label 当作台词说出来')
    check(html.includes('demoMood'), '演示情绪走 demoMood()（说该情绪自己的台词）')
    // v0.15.2：右键「换个表情」已按需求移除（图标没变化时点了像没反应，容易和「说句话」混淆）；
    // 换表情仍可双击循环 / 设置面板九宫格，别把死代码留下
    check(!html.includes('换个表情'), '右键菜单里没有「换个表情」（换表情走双击/面板）')
    check(!html.includes('changeMoodSilently') && !html.includes('quietUntil'), '静默换脸的代码随菜单项一并移除（不留死代码）')
  }

  // 事件桥在引擎侧真的落地（宿主相位优先、DOM 兜底、可开关、{tool} 可插值）
  check(html.includes('EventSource') && html.includes('bootBridge') && html.includes('closeBridge'), '引擎里有事件桥的订阅/退订')
  check(html.includes('effectiveSensor') && html.includes('bridgeFresh'), '引擎里有"桥优先、DOM 兜底"的选择逻辑')
  check(html.includes('staleMs'), '桥断流超时会退回 DOM 传感')
  check(/origin=\(location\.protocol/.test(html) && !/dir=BASE\.slice/.test(html), '事件桥 URL 挂在 origin 上（不是拼到素材目录下）—— 这个 bug 曾被运行时冒烟测试抓到')
  check(html.includes('data-k="bridge"'), '设置面板有事件桥开关')
  check(html.includes('{tool}'), '台词支持 {tool} 插值（点出当前工具名）')
  check(/bridgeLastSpoken/.test(html), '同一相位不会重复报台词')

  // P1 交互与动态扩展（v0.4.0）
  check(html.includes('clickZone') && html.includes('interact.zones'), '按点击落点分区反应（头/身体/尾巴）')
  check(html.includes('updateEdgePeek') && html.includes('edgePeekDeg'), '贴边"探头"（朝屏幕内倾）')
  check(html.includes('glide') && html.includes('dragInertia'), '拖拽松手惯性滑动')
  check(html.includes('maybeStartle') && html.includes('startleApproachPx'), '快速逼近"吓一跳"')
  check(html.includes('onWheel') && html.includes('scrollGaze'), '滚动时视线跟随')
  check(html.includes('startleCooldownMs'), '吓一跳有冷却（不会一直抖）')

  // 音效已按需求整体移除（v0.11.0）：不留半截代码，也不留死素材
  check(cfg.sound === undefined, '配置里已没有 sound 段')
  check(!html.includes('AudioContext') && !html.includes('blip('), '引擎里已没有音频代码')
  check(!html.includes('data-k="sound"'), '设置面板里已没有音效开关')
  check(!html.includes('ui:sound'), '语言包里不再引用音效文案')
  check(!onDisk.has('idle.ogg'), '音效素材 idle.ogg 已删除')
  check(!KNOWN_ASSETS.includes('idle.ogg'), '素材清单里已移除 idle.ogg')
  check(resolveAsset('idle.ogg') === null, '素材路由不再放行 .ogg（扩展名收窄）')
  check(!/ALLOWED_EXT = new Set\(\[[^\]]*ogg/.test(readFileSync(join(here, '..', 'backend.mjs'), 'utf8')), '后端放行规则里不再有音频扩展名')
  // 机制必须在产物里真的落地
  check(html.includes('transientTimer') && html.includes('userTransient'), '注入脚本里有"瞬态必定回落"的机制')
  check(html.includes('scheduleMicro') && html.includes('microAction'), '注入脚本里有待机小动作调度')
  check(html.includes('typewriterCps'), '注入脚本里有逐字气泡')
  check(/behavior\.transientMs/.test(html), '注入脚本读取 behavior 配置（改配置即可调行为）')
}

// ---- 9b) 对话系统：权重与条件、语气梯度、无障碍 ----
{
  const WHEN_KEYS = ['night', 'hourMin', 'hourMax', 'weekday', 'phase', 'bridge', 'streak', 'idleFor', 'minTurns']
  const entries = []
  const collectEntries = (prefix, value) => {
    if (Array.isArray(value)) {
      for (const e of value) {
        if (typeof e === 'string') entries.push([prefix, e, null])
        else if (e && typeof e === 'object') entries.push([prefix, e.line, e])
      }
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) collectEntries(`${prefix}.${k}`, v)
    }
  }
  collectEntries('moods', moods)
  collectEntries('interact', interact)
  collectEntries('random', random)
  collectEntries('time', time)
  collectEntries('context', context)
  collectEntries('bridge', character.bridge?.lines)

  check(entries.length >= 80, `台词条目收集完整（${entries.length} 条）`)
  const withWhen = entries.filter(([, , meta]) => meta && meta.when)
  const withWeight = entries.filter(([, , meta]) => meta && meta.weight != null)
  check(withWhen.length >= 6, `有条件台词（${withWhen.length} 条，考验权重与条件机制）`)
  check(withWeight.length >= 6, `带权重台词（${withWeight.length} 条）`)

  for (const [where, line, meta] of entries) {
    check(typeof line === 'string' && line.length > 0, `${where} 的台词非空`)
    if (!meta) continue
    if (meta.weight != null) check(typeof meta.weight === 'number' && meta.weight > 0, `${where} 的权重是正数（${meta.weight}）`)
    for (const key of Object.keys(meta.when || {})) {
      check(WHEN_KEYS.includes(key), `${where} 的条件键 ${key} 是受支持的（拼错会当场红）`)
    }
    const w = meta.when || {}
    if (w.weekday) check(w.weekday.every((d) => d >= 1 && d <= 7), `${where} 的 weekday 取值 1~7`)
    if (w.streak) {
      check(typeof w.streak.key === 'string' && w.streak.key.length > 0, `${where} 的 streak.key 非空`)
      check(typeof w.streak.min === 'number' && w.streak.min >= 2, `${where} 的 streak.min >= 2（1 次不算"连续"）`)
    }
    if (w.minTurns != null) check(typeof w.minTurns === 'number' && w.minTurns > 0, `${where} 的 minTurns 为正`)
    if (w.idleFor != null) check(typeof w.idleFor === 'number' && w.idleFor > 0, `${where} 的 idleFor 为正`)
    if (w.phase != null) check(Object.keys(character.bridge?.phases || {}).includes(w.phase), `${where} 的 phase 是合法相位（${w.phase}）`)
  }

  // 从**实际产物**里抽出 whenOk / pickWeighted 来测（不是测副本）
  const scriptSrc = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
  const whenOkSrc = /\n  function whenOk\(when\)\{[\s\S]*?\n  \}\n/.exec(scriptSrc)
  check(whenOkSrc !== null, '能从产物里抽出 whenOk（条件求值器）')
  if (whenOkSrc) {
    const makeWhenOk = (env) => new Function(
      'CFG', 'bridgeFresh', 'bridgePhase', 'streaks', 'lastActivity', 'now', 'isNight', 'bridgeTurn',
      `${whenOkSrc[0]}; return whenOk`
    )(
      env.CFG ?? { dialogue: { nightStart: 22, nightEnd: 5 } },
      env.bridgeFresh ?? (() => !!env.bridge),
      env.bridgePhase ?? null,
      env.streaks ?? {},
      env.lastActivity ?? 0,
      env.now ?? (() => 1_000_000),
      env.isNight ?? ((h) => h >= 22 || h < 5),
      env.bridgeTurn ?? 0
    )
    const whenOk = makeWhenOk({})
    check(whenOk(undefined) === true, '无条件条目恒通过')
    check(whenOk({}) === true, '空条件通过')
    check(whenOk({ bridge: true }) === false, 'bridge:true 在桥未连接时不通过')
    check(whenOk({ phase: 'tool' }) === false, 'phase 条件在桥未连接时不通过')
    check(whenOk({ streak: { key: 'error', min: 2 } }) === false, 'streak 未达标时不通过')
    const whenOk2 = makeWhenOk({ streaks: { error: 3 } })
    check(whenOk2({ streak: { key: 'error', min: 2 } }) === true, 'streak 达标时通过')
    check(whenOk2({ streak: { key: 'error', min: 5 } }) === false, 'streak 未达更高门槛时不通过')
    const whenOk3 = makeWhenOk({ bridge: true, bridgePhase: 'tool', bridgeTurn: 5 })
    check(whenOk3({ phase: 'tool' }) === true, '桥新鲜且相位匹配时通过')
    check(whenOk3({ minimum: false, phase: 'done' }) === false, '相位不匹配时不通过')
    check(whenOk3({ minTurns: 3 }) === true, 'minTurns 达标时通过')
    check(whenOk3({ minTurns: 9 }) === false, 'minTurns 未达标时不通过')
    const whenOk4 = makeWhenOk({ isNight: () => false })
    check(whenOk4({ night: true }) === false, 'night 在白天不通过')
    check(whenOk4({ night: false }) === true, 'night:false 在白天通过')
  }

  const pickWeightedSrc = /\n  function pickWeighted\(list\)\{[\s\S]*?\n  \}\n/.exec(scriptSrc)
  check(pickWeightedSrc !== null, '能从产物里抽出 pickWeighted（权重抽签）')
  if (pickWeightedSrc) {
    const pickWeighted = new Function(`${pickWeightedSrc[0]}; return pickWeighted`)()
    let low = 0
    const N = 3000
    for (let i = 0; i < N; i++) {
      if (pickWeighted([{ line: 'a', weight: 1 }, { line: 'b', weight: 3 }]) === 'a') low++
    }
    const ratio = low / N
    check(ratio > 0.15 && ratio < 0.4, `权重生效：权重1的条目占比 ${(ratio * 100).toFixed(1)}%（期望 ~25%）`)
    check(pickWeighted([{ line: 'only', weight: 1 }]) === 'only', '单条目直接返回')
  }
  check(/function candidates\(pool\)\{[\s\S]*?cond\.length\?cond:plain/.test(scriptSrc), '条件条目优先、无条件条目兜底（永不失语）')

  // 无障碍
  check(html.includes('tabindex'), '角色可 Tab 聚焦')
  check(html.includes("setAttribute('role','button')"), '命中层有 button 语义')
  check(/aria-live',\s*'polite'/.test(html) || html.includes("aria-live"), '气泡对屏幕阅读器可见（aria-live）')
  check(html.includes('ArrowLeft') && html.includes('ArrowUp'), '方向键可挪动位置')
  check(html.includes('isContentEditable'), '输入框里不抢键（只有 H 仍生效）')
  check(html.includes('dgw-still'), '有"完全静止"模式（无障碍）')
  check(html.includes('&& !state.still'), '完全静止时待机动画也会停（不然勾了还在动）')

  // 视线/眼神跟随（伪 3D 转头，v0.12.0）
  const gz = cfg.gaze
  check(gz && typeof gz === 'object', '配置里有 gaze 段（转头参数）')
  check(gz.maxYawDeg > 0 && gz.maxYawDeg <= 15, `左右转头角度合理（${gz.maxYawDeg}°，超过 ~10° 会像卡片在转）`)
  check(gz.maxPitchDeg > 0 && gz.maxPitchDeg <= 10, `上下角度合理（${gz.maxPitchDeg}°）`)
  check(gz.smooth > 0 && gz.smooth < 1, `平滑系数在 (0,1)（${gz.smooth}）`)
  check(gz.perspectivePx >= 200, `透视距离合理（${gz.perspectivePx}px）`)
  check(gz.pivotY > 0.2 && gz.pivotY < 0.9, `旋转枢轴在身体范围内（${gz.pivotY}，0.58≈脖子）`)
  check(html.includes('dgw-gaze'), '引擎里插了独立的 gaze 图层')
  check(html.includes('rotateY(') && html.includes('rotateX(') && html.includes('perspective('), '用透视 + 双向旋转实现转头')
  check(html.includes('function updateGaze'), '有独立的视角计算函数')
  check(!html.includes('anim.style.transform'), '转头不写在 anim 上（避免被浮动关键帧动画覆盖）')
  check(html.includes('reduced||state.still'), '减少动态效果 / 完全静止时不做转头')
  check(/\.dgw-gaze\{transform-origin:50% \d+%/.test(html), '转头的枢轴写在 CSS 里（脖子位置）')
  check(html.includes('gaze: {'), 'motion() 报告当前转头角度')
  // v0.15.3：面板暂时不显示"视线跟随"开关（真·眼珠跟随层已回滚，只剩轻微的伪 3D 转头）
  check(cfg.showFollowCursorToggle === false, '配置 showFollowCursorToggle=false（面板暂不显示视线跟随开关）')
  check(/if\(CFG\.showFollowCursorToggle\)\s*html\+=row\(t\('ui:followCursor'/.test(html),
    '视线跟随那一行受 showFollowCursorToggle 控制（默认不渲染）')
  check(html.includes('data-k="followCursor"'), '底层开关与持久化还在（只是面板不显示，改配置可放回）')
  check(/"showFollowCursorToggle":false/.test(html), '注入的配置里确实是 showFollowCursorToggle=false（面板行真的不渲染）')

  // 休闲动作（动态待机动作，v0.13.0）
  const ia = cfg.idleActs
  check(ia && ia.enabled === true, '配置里有 idleActs（休闲动作调度）')
  check(ia.minGapMs >= 10000 && ia.maxGapMs >= ia.minGapMs, `调度间隔合理（${ia.minGapMs}~${ia.maxGapMs}ms）`)
  check(ia.edgeWithinPx > 0 && ia.edgeWithinPx <= 40, `贴边判定阈值合理（${ia.edgeWithinPx}px）`)
  const acts = character.acts || []
  check(acts.length >= 3, `动作表非空（${acts.length} 个：${acts.map((a) => a.id).join(', ')}）`)
  for (const a of acts) {
    check(typeof a.id === 'string' && a.id.length > 0, `动作 ${a.id} 有 id`)
    check(typeof a.label === 'string' && a.label.length > 0, `动作 ${a.id} 有中文名`)
    check(['jog', 'peek', 'lie', 'fan'].includes(a.kind), `动作 ${a.id} 的 kind 受支持（${a.kind}）`)
    check(typeof a.weight === 'number' && a.weight > 0, `动作 ${a.id} 权重为正（${a.weight}）`)
    check(typeof a.ms === 'number' && a.ms >= 1500 && a.ms <= 8000, `动作 ${a.id} 时长合理（${a.ms}ms）`)
    check(a.pose && typeof a.pose === 'object', `动作 ${a.id} 有姿态参数`)
    for (const key of Object.keys(a.when || {})) {
      check(['side', 'anySide', 'bottom', 'notBottom', 'notEdge'].includes(key), `动作 ${a.id} 的位置条件键合法（${key}）`)
    }
    if (a.line) check(a.line.length <= 40, `动作 ${a.id} 的台词够短（${a.line.length} 字）`)
  }
  const wallActs = acts.filter((a) => (a.when || {}).anySide || (a.when || {}).bottom)
  check(wallActs.length >= 2, `有"把边界当墙"的动作（${wallActs.map((a) => a.id).join(', ')}）`)
  const artActs = acts.filter((a) => a.needsArt)
  check(artActs.every((a) => a.artReady !== true), '缺素材的动作标记为 needsArt 且不会被抽到（等素材再启用）')
  check(html.includes('function edgeState'), '引擎能判断"贴住哪条边"')
  check(ia.edgeTrigger === true, '贴边停留即可触发（不必等随机调度）')
  check(ia.edgeDwellMs >= 500 && ia.edgeDwellMs <= 10000, `贴边停留阈值合理（${ia.edgeDwellMs}ms）`)
  check(ia.edgeCooldownMs >= 3000, `贴边触发有冷却，避免一直循环演（${ia.edgeCooldownMs}ms）`)
  check(ia.edgePollMs >= 100 && ia.edgePollMs <= 2000, `贴边检测频率合理（${ia.edgePollMs}ms）`)
  check(html.includes('function edgePoll') && html.includes('startEdgeWatch'), '引擎有贴边轮询与启动函数')
  check(ia.edgeSwitchCooldownMs > 0 && ia.edgeSwitchCooldownMs <= 5000, `换边后冷却很短，换一侧就能立刻演（${ia.edgeSwitchCooldownMs}ms）`)
  check(ia.edgeIgnoreAiState === true, '贴边动作不看 AI 是否在干活（贴到墙边就演）')
  check(html.includes('function canEdgeAct'), '有独立的贴边门禁函数（不共用"真待机"判断）')
  check(!/canEdgeAct[\s\S]{0,200}resolveMood\(\)==='idle'/.test(html) || html.includes('edgeIgnoreAiState===false'), '门禁默认忽略 AI 状态，但保留可回退开关')
  check(html.includes('!edgeState().side'), '贴边时不触发其他闲时动作（只有扒墙偷看）')
  check(html.includes('dir*(-hide+probe)'), '贴边时大部分身体藏在墙外、只探出一部分')
  const peekAct = acts.find((x) => x.id === 'peekEdge') || {}
  check(peekAct.sustain === 'edge', '扒墙偷看是"状态保持"型（离开边缘才结束）')
  check((peekAct.pose || {}).hideFrac > 0.2 && (peekAct.pose || {}).hideFrac < 0.8, `藏身比例合理（${(peekAct.pose || {}).hideFrac}）`)
  check(html.includes('actPose.side>0?-1:1'), '左边缘镜像、右边缘用原图（实测方向修正）')
  check(html.includes("act.sustain==='edge'"), '引擎支持状态保持型动作')
  check(!/function onUp\(\)\{[\s\S]{0,80}stopAct\(true\)/.test(html), 'onUp 里不再中止动作（页面别处松鼠标不该结束保持态）')
  check(html.includes("id!=='idle'&&!actCurrent.sustain"), 'AI 状态变化不打断保持态动作')
  check(html.includes('edgeDwellMs: edgeSince?now()-edgeSince:0'), '诊断里能看到贴边已停留多久')
  check(html.includes('function pickAct') && html.includes('function scheduleAct') && html.includes('function actPoseAt'), '动作调度 / 挑选 / 姿态曲线都在')
  check(html.includes('stopAct(true)') && (html.match(/stopAct\(true\)/g) || []).length >= 4, '用户操作、状态切换、隐藏都会打断动作')
  check(html.includes('if(state.still||reduced) return false'), '完全静止 / 减少动态时拒绝启动动作')
  check(html.includes('translate(') && html.includes('rotateY(') && html.includes('scale('), '动作姿态与视线合成到同一层（不会互相覆盖）')
  check(html.includes('act: { id:'), 'motion() 报告当前动作与贴边状态')
  check(html.includes('act:function(') && html.includes('stopAct:function('), '调试钩子能手动触发/中止动作')
  check(!html.includes('静音') && !html.includes('开声'), '右键菜单里不再有静音/开声（音效已移除）')
  check(html.includes('ui:autoSpeak'), '但「自动说话」开关还在（气泡台词仍可一键关掉）')
  check(html.includes('data-k="still"'), '设置面板可切完全静止')
  check(html.includes('focus-visible'), '键盘聚焦有可见描边')
  check(html.includes('{turn}') && html.includes('{streak}'), '语境化插值支持 {turn} / {streak}')
}

// ---- 8d) 贴边保持态的"眼睛会动"（眨眼 + 待机式微摆，v0.15.0）----
{
  const peekAct = (character.acts || []).find((x) => x.id === 'peekEdge') || {}
  const el = peekAct.eyeLife
  check(!!el && typeof el === 'object', '扒墙偷看配了 eyeLife（保持态的眼睛活动）')
  check(!!el && (peekAct.frames || []).includes(el.base), `眨眼基准帧来自动作帧序列（${el && el.base}）`)
  check(!!el && /\.png$/.test(String(el.blink)), `闭眼帧是 png（${el && el.blink}）`)
  check(!!el && el.blink !== el.base, '闭眼帧与基准帧不是同一张（否则眨眼看不出变化）')
  check(!!el && el.blinkMs >= 60 && el.blinkMs <= 400, `闭眼停留时长像人眨眼（${el && el.blinkMs}ms）`)
  check(!!el && Array.isArray(el.gapMs) && el.gapMs[0] >= 800 && el.gapMs[1] >= el.gapMs[0], `眨眼间隔合理（${el && JSON.stringify(el.gapMs)}）`)
  const pose = peekAct.pose || {}
  check(pose.swayDeg > 0 && pose.swayDeg <= 6, `保持态有慢速微摆（${pose.swayDeg}°）`)
  check(pose.swayHz > 0 && pose.swayHz <= 1, `微摆频率是"慢摆"而不是抖（${pose.swayHz}Hz）`)

  // 素材：闭眼帧必须在 assets/ 里、且能被素材路由放行，否则真机上眨眼会 404
  check(onDisk.has(el.blink), `闭眼帧素材存在（assets/${el.blink}）`)
  check(resolveAsset(el.blink) !== null, `素材路由放行闭眼帧（${el.blink}）`)
  for (const f of peekAct.frames || []) check(onDisk.has(f), `扒墙偷看帧存在（assets/${f}）`)
  check(existsSync(join(here, '..', 'tools', 'build-eye-life.ps1')), '生成闭眼帧的工具脚本在（tools/build-eye-life.ps1，可重复生成）')
  check(existsSync(join(here, '..', 'docs', 'eye-life-preview.png')), '闭眼帧有目视验收图（docs/eye-life-preview.png）')
  check(existsSync(join(here, '..', 'docs', 'eye-life-realsize.png')), '闭眼帧有真实显示尺寸的验收图（docs/eye-life-realsize.png）')

  // 引擎：眨眼只能在"停在基准帧"时发生（别的帧眼位不同，换了会错位）
  check(html.includes('"eyeLife"') && html.includes(el.blink), '注入产物里真的带上了眨眼配置与闭眼帧文件名（配置被序列化进页面）')
  check(html.includes('function updateEyeLife'), '引擎有保持态眨眼逻辑 updateEyeLife')
  check(html.includes('actFrameFile===el.base'), '只在这一帧（眼睛的真实位置）换闭眼帧')
  check(html.includes('eyeBlinkOn') && html.includes('eyeNextBlinkAt'), '引擎维护眨眼状态与下次眨眼时间')
  check(html.includes('function blinkGap') && html.includes('Math.random()'), '眨眼间隔带随机（不像节拍器）')
  check(html.includes('actFrameIdx===(act.frames.length-1)'), '帧序列播完停在最后一帧后才开始眨眼')
  check(/stopAct[\s\S]{0,200}eyeBlinkOn=false/.test(html), '动作结束/被打断时清掉眨眼状态（不留残影）')
  check(html.includes('eye: (actCurrent&&actCurrent.eyeLife)'), 'motion() 报告眨眼状态（blinking / nextInMs / resting）')
  check(html.includes('blink:function()'), '调试钩子能手动眨一次（__dshWhaleGirl.blink()）')
  check(html.includes('p.swayDeg'), '保持态的微摆由 pose.swayDeg 驱动（可关）')
}

// ---- 9c) 台词本地覆写（面板编辑）：数据、净化、调用点全覆盖 ----
{
  const scriptSrc = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
  // 模板字符串会把 \n、\/、反引号吃掉：注入产物里绝不能有裸反引号
  check(scriptSrc.split(String.fromCharCode(96)).length - 1 === 0, '注入产物里没有裸反引号（模板字符串会吃掉它）')
  check(/var BACKTICK=String\.fromCharCode\(96\)/.test(scriptSrc), '需要反引号字符时用 String.fromCharCode(96) 拿（而不是直接写）')
  check(/NL=String\.fromCharCode\(10\)/.test(scriptSrc) && /split\(NL\)/.test(scriptSrc), '换行用 NL 常量切分（直接写 \\n 会被模板吃掉）')

  check(html.includes('dialoguePoolList') && html.includes('dialogueDefaults') && html.includes('dialogueText'), '面板能列出全部台词池并取默认值')
  check(html.includes('sanitizeLines'), '覆写台词会被净化（去换行/去反引号/截断）')
  check(/out\.length<40/.test(scriptSrc) && /slice\(0,80\)/.test(scriptSrc), '覆写有上限（40 行 / 单句 80 字）')
  check(html.includes(".dialogue'"), '台词覆写用独立的 localStorage 键（与设置分开存）')
  check(html.includes('loadDialogueOverrides') && html.includes('saveDialogueOverrides'), '覆写的读/写都在')

  const keyed = (scriptSrc.match(/poolFor\(/g) || []).length
  check(keyed >= 12, `台词调用点都走 poolFor（${keyed} 处，少一处就会"改了没反应"）`)
  check(/poolFor\('mood:'\+/.test(scriptSrc) && /poolFor\('interact\./.test(scriptSrc) && /poolFor\('bridge:'/.test(scriptSrc), '情绪/交互/事件桥三类台词都可覆写')
  check(/lineFor\('micro:'\+/.test(scriptSrc), '待机小动作台词可覆写')

  check(html.includes('data-dlg="pick"') && html.includes('data-dlg="text"'), '面板里有台词池选择与编辑框')
  check(html.includes('data-dlg="save"') && html.includes('data-dlg="reset"') && html.includes('data-dlg="export"'), '面板里有保存/恢复默认/导出 JSON')
  check(html.includes('不可在面板修改'), '条件台词在面板里标为只读（带 # 前缀，保存时忽略）')
  check(html.includes('dialogue:function('), '调试钩子能读写台词覆写')
  check(html.includes('bindDialogueEditor'), '面板打开时会渲染台词编辑器')
}

// ---- 9d) i18n：语言包与中文池子的键/条件严格对齐，译文里不能残留中文 ----
{
  const scriptSrc = /<script>([\s\S]*?)<\/script>/.exec(html)[1]
  const packs = character.locales || {}
  check(Object.keys(packs).includes('en'), '英文语言包已加载（i18n/mascot.en.json）')
  const en = packs.en || {}

  // 中文侧的键空间（与引擎里 poolFor 的 key 一一对应）
  const zhKeys = new Set()
  for (const [id, m] of Object.entries(moods)) zhKeys.add(`mood:${id}`)
  for (const [g, list] of Object.entries(interact || {})) {
    if (Array.isArray(list)) zhKeys.add(`interact.${g}`)
    else for (const z of Object.keys(list)) zhKeys.add(`zone:${z}`)
  }
  for (const phase of Object.keys(character.bridge?.lines || {})) zhKeys.add(`bridge:${phase}`)
  for (const seg of Object.keys(time || {})) zhKeys.add(`time:${seg}`)
  zhKeys.add('random')
  for (const m of micro) if (m.line) zhKeys.add(`micro:${m.id}`)

  const enKeys = Object.keys(en)
  const enUi = enKeys.filter((k) => k.startsWith('ui:') || k.startsWith('label:'))
  const enDialogue = enKeys.filter((k) => !k.startsWith('ui:') && !k.startsWith('label:'))
  const missing = [...zhKeys].filter((k) => !enDialogue.includes(k))
  const extra = enDialogue.filter((k) => !zhKeys.has(k))
  check(missing.length === 0, `英文包覆盖全部台词池（缺 ${missing.length} 个${missing.length ? '：' + missing.slice(0, 5).join(', ') : ''}）`)
  check(extra.length === 0, `英文包没有多余/拼错的键（多余 ${extra.length} 个${extra.length ? '：' + extra.slice(0, 5).join(', ') : ''}）`)
  check(enKeys.length >= 30, `英文包键数合理（${enKeys.length}）`)

  const zhPool = (key) => {
    if (key.startsWith('mood:')) return moods[key.slice(5)]?.pool || []
    if (key.startsWith('interact.')) return interact[key.slice(9)] || []
    if (key.startsWith('zone:')) return interact.zones?.[key.slice(5)] || []
    if (key.startsWith('bridge:')) return character.bridge?.lines?.[key.slice(7)] || []
    if (key.startsWith('time:')) return time[key.slice(5)] || []
    if (key.startsWith('micro:')) return micro.filter((m) => m.id === key.slice(6)).map((m) => m.line)
    if (key === 'random') return random || []
    return []
  }

  const CJK = /[\u4e00-\u9fff]/
  let enLines = 0
  let condLines = 0
  for (const key of enDialogue) {
    const lines = en[key]
    check(Array.isArray(lines) && lines.length > 0, `${key} 的英文包是非空数组`)
    check(lines.length <= zhPool(key).length + 2, `${key} 的英文条目数没有异常膨胀（${lines.length}）`)
    for (const entry of lines) {
      const line = typeof entry === 'string' ? entry : entry?.line
      check(typeof line === 'string' && line.trim().length > 0, `${key} 的英文台词非空`)
      if (typeof line === 'string') {
        enLines++
        check(!CJK.test(line), `${key} 的英文台词没有残留中文：${line.slice(0, 24)}`)
        check(line.length <= 72, `${key} 的英文台词长度合理（${line.length} ≤ 72）`)
        check(!line.includes('`'), `${key} 的英文台词没有反引号（气泡是纯文本）`)
        check(!/(现在是|状态：|测试台词)/.test(line), `${key} 的英文台词没有"系统播报"腔`)
      }
    }
    // 条件条目必须与中文版条件一致（否则语气梯度等在英文下会失效）
    const zhCond = zhPool(key).filter((e) => e && typeof e === 'object')
    const enCond = lines.filter((e) => e && typeof e === 'object')
    if (zhCond.length > 0) {
      check(enCond.length > 0, `${key} 的条件台词在英文包里也保留了（中文 ${zhCond.length} 条）`)
      for (const e of enCond) {
        condLines++
        check(!!e.when && typeof e.when === 'object', `${key} 的英文条件条目带 when`)
        check(zhCond.some((z) => JSON.stringify(z.when) === JSON.stringify(e.when)), `${key} 的英文条件与中文一致：${JSON.stringify(e.when)}`)
      }
    }
  }
  check(enLines >= 100, `英文台词总量足够（${enLines} 句）`)
  check(condLines >= 5, `英文包里保留了条件台词（${condLines} 条，语气梯度等机制不丢）`)

  // 面板文案（ui:*）与情绪名（label:*）：用到必有译文、译了必被用到
  const usedUi = [...new Set([...scriptSrc.matchAll(/t\('(ui:[A-Za-z]+)'/g)].map((m) => m[1]))]
  const usedLabels = Object.keys(moods).map((id) => `label:${id}`)   // moodLabel() 按情绪 id 取
  check(usedUi.length >= 15, `引擎里本地化了 ${usedUi.length} 处面板文案`)
  const uiNoTr = usedUi.concat(usedLabels).filter((k) => !enUi.includes(k))
  const uiUnused = enUi.filter((k) => !usedUi.includes(k) && !usedLabels.includes(k))
  check(uiNoTr.length === 0, `用到的面板文案/情绪名都有英文（缺 ${uiNoTr.length} 个${uiNoTr.length ? '：' + uiNoTr.join(', ') : ''}）`)
  check(uiUnused.length === 0, `英文包里的面板文案都被用到（多余 ${uiUnused.length} 个${uiUnused.length ? '：' + uiUnused.join(', ') : ''}）`)
  check(usedLabels.every((k) => enUi.includes(k)), `9 个情绪名都有英文译文（${usedLabels.length} 个）`)
  check(html.includes('function moodLabel(id)'), '情绪名统一走 moodLabel（面板/提示/插值一处生效）')

  // 引擎侧真的接了语言层
  check(html.includes('LOCALES') && html.includes('effectiveLang') && html.includes('detectedLang'), '引擎有语言选择逻辑')
  check(html.includes('var pack=localePack();'), 'poolFor 里插了语言包一层（覆写 > 语言包 > 中文）')
  check(html.includes('data-k="lang"'), '设置面板有语言选择')
  check(html.includes('__DSH_LOCALE__'), '语言默认跟随宿主/浏览器（可被 state.lang 覆盖）')
  check(html.includes('i18n:'), 'motion() 报告当前语言与可用语言包')
  check(html.includes('poolFor(key, dialogueDefaults(key))'), '面板里看到的就是当前语言（不会面板中文嘴上英文）')
  check(html.includes('跟随界面'), '语言默认是"自动"而不是写死中文')
}

// ---- 9e) 插件元信息契约：locale/ 里的文件名必须是"语言 id" ----
// 宿主读插件标题/描述时会扫 `locale/*.json` 整个目录，并把文件名当成语言 id 校验
// （packages/boot/app-boot/src/package-meta.ts 的 dictionariesOf + LANGUAGE_ID）。
// 曾经因为把角色台词包命名成 locale/mascot.en.json（带点号）→ 插件管理面板直接报
// "must use a language id as its filename"。这里把规则照抄一份，防止再踩。
{
  const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u   // 与宿主源码一字不差
  const localeDir = join(here, '..', 'locale')
  const localeFiles = readdirSync(localeDir).filter((f) => f.endsWith('.json'))
  check(localeFiles.length >= 1, `locale/ 里有插件显示文案（${localeFiles.join(', ')}）`)
  const seen = new Set()
  for (const file of localeFiles) {
    const id = file.slice(0, -5)
    check(LANGUAGE_ID.test(id), `locale/${file} 的文件名是合法语言 id（${id}）`)
    check(!seen.has(id.toLowerCase()), `locale/${id} 没有重复的语言 id（大小写也算重复）`)
    seen.add(id.toLowerCase())
  }
  check(localeFiles.includes('en.json'), 'locale/en.json 在位（宿主以它为锚点去找同目录其它语言）')
  const enMeta = JSON.parse(readFileSync(join(localeDir, 'en.json'), 'utf8')).meta || {}
  check(typeof enMeta.title === 'string' && enMeta.title.trim() !== '', 'locale/en.json 带 meta.title（插件管理器显示用）')
  check(typeof enMeta.description === 'string' && enMeta.description.trim() !== '', 'locale/en.json 带 meta.description')
  const zhMeta = JSON.parse(readFileSync(join(localeDir, 'zh.json'), 'utf8')).meta || {}
  check(typeof zhMeta.title === 'string' && zhMeta.title.trim() !== '' && typeof zhMeta.description === 'string', 'locale/zh.json 带 meta.title/description')

  // 角色台词包必须放在 locale/ 之外（否则文件名里的点号会踩上面那条规则）
  check(!existsSync(join(localeDir, 'mascot.en.json')), '角色台词包不在 locale/ 里（mascot.en.json 会踩语言 id 校验）')
  check(existsSync(join(here, '..', 'i18n', 'mascot.en.json')), '角色台词包在 i18n/mascot.en.json')
  check(readFileSync(join(here, '..', 'character.mjs'), 'utf8').includes('./i18n/mascot.'), 'character.mjs 从 i18n/ 加载台词包')
  check(pkg.files.includes('i18n/'), 'package.json 的 files 包含 i18n/（否则发布后英文包丢失）')
  check(typeof pkg.exports?.['./i18n/*.json'] === 'string', 'package.json 导出 ./i18n/*.json（按需可被宿主解析）')
  check(typeof pkg.exports?.['./locale/*.json'] === 'string', 'package.json 仍导出 ./locale/*.json（宿主靠它找显示文案）')
}

// ---- 10) 热更新机制：带 ?v= 重新 import 必须重新求值（否则改了配置也不生效）----
{
  const url = pathToFileURL(join(here, '..', 'mascot.config.mjs')).href
  const [m1, m2] = await Promise.all([import(url), import(`${url}?v=hot-test`)])
  check(m1.default !== m2.default, '?v= 查询串能让模块重新求值（热更新机制成立）')
  check(JSON.stringify(m1.default) === JSON.stringify(m2.default), '重新求值得到的配置内容一致')
}

// ---- 输出 ----
console.log(notes.join('\n'))
if (failures.length > 0) {
  console.error('\n' + failures.join('\n'))
  console.error(`\n✗ ${failures.length} 项检查失败`)
  process.exit(1)
}
console.log(`\n✓ 全部检查通过（情绪 ${Object.keys(moods).length} 个，素材 ${onDisk.size} 个文件，共 ${mb.toFixed(2)} MB）`)
