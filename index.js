// index.js — dsh-whale-girl-plugin 入口（Host 侧）
// 通过官方接缝向每次 index.html 响应注入样式 + 引擎脚本（webServer.tapIndex），
// 并注册两个路由：/__mascot/asset/*（透明表情集 + 待机动画素材）与 /__mascot/status（活跃 workspace + 自检）。
// 不修改 dsh 核心源码、不依赖构建链；effect 清理保证热重载/卸载不重复注册。
//
// 另外做了一件对迭代很关键的事：**改动 engine/config/character 后无需重启 dsh**。
// 本进程每 2s 检查这三个文件的 mtime，有变化就带 ?v=mtime 重新 import（node 的 ESM 缓存按 URL 区分）
// 重建注入片段；页面刷新即生效。用户编辑写出语法错误时保留上一份可用片段并在日志里告警。
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerMascotRoutes, ASSET_PREFIX, EVENTS_PATH, ENGINE_PATH } from './backend.mjs'
import { createActivityBridge, attachActivityBridge } from './bridge.mjs'
import { buildInject, renderInject, renderCompact, renderClientScript } from './engine.mjs'

export const name = 'dsh-whale-girl-plugin'

/** 素材 URL 前缀（与 backend.mjs 注册的 prefix 路由一致），注入为绝对路径由引擎补全协议与主机。 */
const ASSET_BASE = `${ASSET_PREFIX}/`

/** 版本号参与素材 URL 的 cache-busting：升级插件后浏览器不会用旧表情图。 */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0'
  } catch {
    return '0'
  }
})()

/** 参与热更新的源文件（改这些不用重启 dsh）。 */
const HOT_FILES = ['engine.mjs', 'mascot.config.mjs', 'character.mjs']
/** 需要重启才能换代的宿主侧文件（改了只能提示，无法热更）。 */
const RESTART_FILES = ['index.js', 'backend.mjs']
const HOT_PATHS = Object.fromEntries(
  [...HOT_FILES, ...RESTART_FILES].map((f) => [f, fileURLToPath(new URL(`./${f}`, import.meta.url))])
)

/** 本世代加载时各文件的 mtime（用于判断"改了但没生效"）。 */
const LOAD_MTIMES = snapshotMtimes()

// 注入形态：
//   inline   —— 配置/角色/引擎全部内联在 index.html（~85KB，永远可用，无额外请求）
//   external —— index.html 只留 <style> + 数据 <script> + <script src=引擎>（~16KB），
//               引擎脚本由 Host 路由提供，可被浏览器缓存（ETag/304）
// 安全性：**只有引擎路由注册成功后**才切到 external；否则一直用 inline。
// 这样"宿主侧还没重启换代"时绝不会出现"刷新后看板娘不见了"。
let engineMode = 'inline'
let snippet = renderInject(ASSET_BASE, VERSION)

/**
 * 当前生效的引擎模块。
 * 外链形态下 /__mascot/engine.js 是**每次请求现场渲染**的；如果这里一直指着进程启动时
 * `import` 进来的那份模块，热更新换掉的 engine.mjs 就永远到不了页面（刷新也没用）——
 * 改 engine / config / character 只有内联形态能热更，外链形态必须重启。
 * 所以 hotReload() 成功后把这份引用换成带 ?v= 重新 import 的模块。
 */
let activeEngine = { renderClientScript }

/** 按当前形态构建注入片段（热更新与路由就绪时都会重新调用）。 */
function buildSnippet(engMod, cfgMod, chrMod) {
  const b = engMod || { buildInject, renderInject }
  const cfg = cfgMod ? cfgMod.default : undefined
  const chr = chrMod ? chrMod.default : undefined
  if (engineMode === 'external' && typeof b.buildCompactInject === 'function' && cfg && chr) {
    try {
      return b.buildCompactInject(cfg, chr, ASSET_BASE, VERSION, ENGINE_PATH)
    } catch (err) {
      console.warn('[dsh-whale-girl-plugin] 外链形态构建失败，退回内联：', err instanceof Error ? err.message : String(err))
      engineMode = 'inline'
    }
  }
  if (cfg && chr && typeof b.buildInject === 'function') return b.buildInject(cfg, chr, ASSET_BASE, VERSION)
  return b.renderInject ? b.renderInject(ASSET_BASE, VERSION) : renderInject(ASSET_BASE, VERSION)
}

/** 引擎路由就绪后切到外链形态（拿默认配置渲染一次即可）。 */
function enableExternalMode() {
  try {
    snippet = renderCompact(ASSET_BASE, VERSION, ENGINE_PATH)
    engineMode = 'external'
    return true
  } catch (err) {
    console.warn('[dsh-whale-girl-plugin] 无法切到外链形态，继续内联：', err instanceof Error ? err.message : String(err))
    engineMode = 'inline'
    return false
  }
}
let stamp = currentStamp()
let hotReloads = 0
let reloading = false
let restartWarned = false

function mtimeOf(file) {
  try { return statSync(HOT_PATHS[file]).mtimeMs } catch { return 0 }
}
function snapshotMtimes() {
  return Object.fromEntries(Object.keys(HOT_PATHS).map((f) => [f, mtimeOf(f)]))
}
/** 三个热更源文件的 mtime 指纹；任一变化就触发一次热更新。 */
function currentStamp() {
  return HOT_FILES.map((f) => mtimeOf(f)).join('-')
}
/** 宿主侧文件是否已被改动（这些改动只有重启才生效）。 */
function staleRestartFiles() {
  return RESTART_FILES.filter((f) => mtimeOf(f) > (LOAD_MTIMES[f] || 0))
}

/**
 * 检查并重建注入片段。
 * @returns {Promise<'ok'|'failed'|'unchanged'>}
 */
async function hotReload() {
  // 宿主侧文件（index.js / backend.mjs）改了只能重启：明确提示一次，避免"以为热更了其实没有"
  const stale = staleRestartFiles()
  if (stale.length > 0 && !restartWarned) {
    restartWarned = true
    console.warn(`[dsh-whale-girl-plugin] ${stale.join(' / ')} 已改动 —— 这两个文件属于宿主侧，需要重启 dsh 才生效（engine/config/character 才是免重启的）`)
  }
  const next = currentStamp()
  if (next === stamp || reloading) return 'unchanged'
  reloading = true
  try {
    const bust = `?v=${encodeURIComponent(next)}`
    const [engMod, cfgMod, chrMod] = await Promise.all([
      import(pathToFileURL(HOT_PATHS['engine.mjs']).href + bust),
      import(pathToFileURL(HOT_PATHS['mascot.config.mjs']).href + bust),
      import(pathToFileURL(HOT_PATHS['character.mjs']).href + bust)
    ])
    const built = buildSnippet(engMod, cfgMod, chrMod)
    if (typeof built !== 'string' || built.length === 0) throw new Error('buildInject 返回空片段')
    // 引擎路由必须跟着换：否则页面刷新拿到的还是进程启动时那份旧代码
    if (engMod && typeof engMod.renderClientScript === 'function') activeEngine = engMod
    snippet = built
    stamp = next
    hotReloads += 1
    console.log(`[dsh-whale-girl-plugin] 已热更新注入片段（第 ${hotReloads} 次，${built.length} 字节）— 刷新页面即生效`)
    return 'ok'
  } catch (err) {
    // 记下 mtime 避免每 2s 重试刷屏；用户改好后的新 mtime 会再触发一次
    stamp = next
    console.warn('[dsh-whale-girl-plugin] 热更新失败，继续用上一份可用片段：', err instanceof Error ? err.message : String(err))
    return 'failed'
  } finally {
    reloading = false
  }
}

/**
 * 把鲸鱼娘样式 + 引擎脚本注入到 index.html 的 </head> 之前（脚本自身等 body 就绪再挂载）。
 * 同步函数（tapIndex 契约）：返回最近一次成功构建的片段。
 * @param {string} html 原始 index.html
 * @returns {string} 注入后的 html
 */
function injectAll(html) {
  const headEnd = /<\/head>/i.exec(html)
  if (headEnd === null) return html + snippet
  return html.slice(0, headEnd.index) + snippet + html.slice(headEnd.index)
}

/**
 * 自检信息：随 /__mascot/status 返回，便于在浏览器之外确认注入片段、素材前缀与事件桥相位
 * （`curl http://127.0.0.1:<port>/__mascot/status`）。
 * @param {object} [bridge] 事件桥
 */
function diagnostics(bridge) {
  return {
    version: VERSION,
    assetBase: ASSET_BASE,
    eventsPath: EVENTS_PATH,
    enginePath: ENGINE_PATH,
    engineMode: engineMode,
    clientBytes: (() => { try { return activeEngine.renderClientScript(ASSET_BASE, VERSION).length } catch { return 0 } })(),
    injectBytes: Buffer.byteLength(snippet, 'utf8'),
    injectHasStyle: snippet.includes('id="dsh-whale-girl-style"'),
    injectHasEngine: snippet.includes('window.__dshWhaleGirl'),
    hotReloads,
    watchFiles: HOT_FILES,
    hotReloadSupported: true,
    /** 非空表示这些宿主侧文件改过但还没重启 —— 当前跑的是旧代码。 */
    needsRestart: staleRestartFiles(),
    /** 事件桥当前相位（`curl` 就能看到 AI 在干什么）与各事件命中次数。 */
    bridge: bridge ? { ...bridge.snapshot(), counters: bridge.counters() } : null
  }
}

/**
 * Host 插件入口：等待 webServer 服务可用后注册注入、路由、事件桥与热更新轮询。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => {
        // 事件桥：订阅宿主 cordis 事件（agent/status、tools/*、agent/turn-stopping……），
        // 折成相位后用 SSE 推给页面；订阅失败/事件缺失都不影响插件本身。
        const bridge = createActivityBridge()
        const disposeBridge = attachActivityBridge(ctx, bridge)
        const disposeTap = httpCtx.webServer.tapIndex(injectAll)
        const disposeRoutes = registerMascotRoutes(
          httpCtx.webServer,
          () => diagnostics(bridge),
          bridge,
          // 引擎脚本路由：内容由**当前** engine.mjs 渲染（热更新后 activeEngine 已换代，ETag 跟着变 → 浏览器自动取新版）
          { path: ENGINE_PATH, render: () => activeEngine.renderClientScript(ASSET_BASE, VERSION) }
        )
        // 路由注册成功 = 页面能取到引擎脚本，这时才切外链形态（index.html 从 ~85KB 降到 ~16KB）
        if (enableExternalMode()) {
          console.log(`[dsh-whale-girl-plugin] 注入形态：外链（index.html ${Buffer.byteLength(snippet, 'utf8')} 字节，引擎 ${Buffer.byteLength(activeEngine.renderClientScript(ASSET_BASE, VERSION), 'utf8')} 字节单独缓存）`)
        }
        // 改动 engine/config/character 后自动重建注入片段（不必重启 dsh，刷新页面即可）
        const watch = setInterval(() => { void hotReload() }, 2000)
        if (typeof watch.unref === 'function') watch.unref()
        void hotReload() // 启动时对齐一次
        return () => {
          try { clearInterval(watch) } catch {}
          try { disposeTap() } catch {}
          try { disposeRoutes() } catch {}
          try { disposeBridge() } catch {}
        }
      },
      'dsh-whale-girl-plugin: 注入看板娘 + /__mascot/asset + /__mascot/status + /__mascot/events（事件桥）+ 源码热更新'
    )
  })
}
