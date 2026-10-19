// backend.mjs — DeepSeek 鲸鱼娘看板娘 · 后端（可选增强，纯前端也能跑）
// 注册三个路由：
//   GET /__mascot/asset/<file>  素材服务：assets/ 下的透明 PNG 表情集与 idle.webm 待机动画
//                               （白名单 + 路径穿越防护 + ETag/304 + Range 206，供 <video> 使用）
//   GET /__mascot/status        上下文服务：返回最近活跃 workspace，供台词 {workspace} 插值（带自检信息）
//   GET /__mascot/events        事件桥 SSE：宿主 cordis 事件折成的相位，推给页面（见 bridge.mjs）
// 都通过 webServer.register 注册，返回 disposer 由 index.js 放进 effect，热重载不重复注册。
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEventRoute } from './bridge.mjs'

/** 素材目录（随包发布，index.js 注入的 URL 前缀与此一一对应）。 */
export const ASSET_PREFIX = '/__mascot/asset'
export const STATUS_PATH = '/__mascot/status'
export const EVENTS_PATH = '/__mascot/events'
export const ENGINE_PATH = '/__mascot/engine.js'

const ASSET_DIR = fileURLToPath(new URL('./assets/', import.meta.url))

/**
 * 允许对外提供的素材扩展名：防止任意文件读取（assets/ 下的 .png/.webm/.ogg/.json 才放行）。
 * 用"目录 + 扩展名白名单 + 裸文件名"三条代替硬编码清单：这样加皮肤/音效不必改代码，
 * 同时 .js/.mjs/.cs 之类仍然取不到（也仍然挡得住路径穿越）。
 */
const ALLOWED_EXT = new Set(['.png', '.webm'])
/** 仍保留一份显式清单用于自检与文档（不是放行条件，只是"预期存在"的记录）。 */
export const KNOWN_ASSETS = [
  'idle.png',
  'thinking.png',
  'happy.png',
  'sad.png',
  'angry.png',
  'sleep.png',
  'dizzy.png',
  'talk-closed.png',
  'talk-open.png',
  'idle.webm'
]

const MIME = {
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
}

function send(res, status, headers, body) {
  res.writeHead(status, headers)
  if (body === undefined) res.end()
  else res.end(body)
}

function sendJSON(res, status, obj) {
  send(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  }, JSON.stringify(obj))
}

/**
 * 把 /__mascot/asset/xxx 的尾部解析成 assets/ 下的绝对路径；任何越界返回 null。
 * 三条规则：① 必须是裸文件名（挡 `../`、`\`、盘符、NUL）；② 扩展名在放行集合内（挡 .js/.cs 等）；
 * ③ 拼出来的路径必须仍在 ASSET_DIR 内（双保险）。加音效/皮肤不必改代码，否则安全规则依旧。
 */
export function resolveAsset(nameFromUrl) {
  let name = nameFromUrl
  try { name = decodeURIComponent(nameFromUrl) } catch { return null }
  if (!name || name.includes('\u0000')) return null
  // 只接受裸文件名：拒绝子路径、盘符、反斜杠与 ..
  if (name !== posix.basename(name) || name.includes('\\') || name.includes('..')) return null
  if (name.startsWith('.')) return null
  if (!ALLOWED_EXT.has(extname(name).toLowerCase())) return null
  const full = join(ASSET_DIR, name)
  // 双保险：解析后的路径必须还在素材目录里
  if (!full.startsWith(ASSET_DIR)) return null
  return full
}

async function handleAsset(req, res, prefix) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    send(res, 405, { Allow: 'GET, HEAD' })
    return
  }
  const rawPath = new URL(req.url || '/', 'http://x').pathname
  const rest = rawPath.slice(prefix.length).replace(/^\/+/, '')
  const file = resolveAsset(rest)
  if (file === null) {
    sendJSON(res, 404, { error: 'asset_not_found', message: `素材不在白名单内或文件名非法：${rest}` })
    return
  }

  let info
  try {
    info = await stat(file)
  } catch {
    sendJSON(res, 404, { error: 'asset_missing', message: `素材文件不存在：${rest}（可能需要重新安装插件以包含 assets/）` })
    return
  }
  if (!info.isFile()) {
    sendJSON(res, 404, { error: 'asset_not_file', message: rest })
    return
  }

  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const base = {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
    'Accept-Ranges': 'bytes'
  }

  if (req.headers['if-none-match'] === etag) {
    send(res, 304, base)
    return
  }

  // <video> 会发 Range 请求；不支持 Range 时浏览器仍能播，但支持更稳（可 seek/局部读）。
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim())
  if (range !== null) {
    const size = info.size
    let start = range[1] === '' ? null : Number(range[1])
    let end = range[2] === '' ? null : Number(range[2])
    if (start === null && end === null) {
      send(res, 416, { ...base, 'Content-Range': `bytes */${size}` })
      return
    }
    if (start === null) { // 后缀范围：最后 N 字节
      start = Math.max(0, size - end)
      end = size - 1
    } else if (end === null || end >= size) {
      end = size - 1
    }
    if (start > end || start >= size) {
      send(res, 416, { ...base, 'Content-Range': `bytes */${size}` })
      return
    }
    const headers = { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
    if (method === 'HEAD') { send(res, 206, headers); return }
    res.writeHead(206, headers)
    const stream = createReadStream(file, { start, end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }

  const headers = { ...base, 'Content-Length': String(info.size) }
  if (method === 'HEAD') { send(res, 200, headers); return }
  res.writeHead(200, headers)
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

// ---------------- 上下文状态 ----------------

const WORKSPACE_FILE = join(homedir(), '.dsh', 'storages', 'workspace.json')
const CACHE_TTL_MS = 30 * 1000
let cache = null

async function readActiveWorkspace() {
  try {
    const raw = await readFile(WORKSPACE_FILE, 'utf8')
    const data = JSON.parse(raw)
    const table = data && data.tables && data.tables.workspaces
    if (!table || typeof table !== 'object') return null
    const list = Object.entries(table).map(([id, w]) => ({
      id,
      path: (w && w.path) || '',
      title: (w && w.title) || String((w && w.path) || '').split(/[\\/]/).pop() || id,
      updatedAt: (w && w.updatedAt) || ''
    }))
    // 最近更新的 workspace 作为“当前活跃”
    list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return list[0] || null
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * 引擎脚本路由：GET /__mascot/engine.js（外链注入形态用）。
 * 内容由 index.js 现场渲染（所以 engine.mjs 热更新后内容跟着变），ETag 基于内容哈希：
 * 内容没变 → 304，浏览器直接用自己的缓存；变了 → 200 + 新 ETag。
 * @param {{render: () => string}} options render() 返回当前引擎脚本源码
 */
export function createEngineRoute({ path = ENGINE_PATH, render } = {}) {
  return {
    kind: 'exact',
    path,
    handler(req, res) {
      const method = req.method || 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, { Allow: 'GET, HEAD' })
        return
      }
      let source = ''
      try {
        source = String(render ? render() : '')
      } catch (err) {
        sendJSON(res, 500, { error: 'engine_render_failed', message: String((err && err.message) || err) })
        return
      }
      const etag = '"' + createHash('sha1').update(source).digest('hex').slice(0, 20) + '"'
      // 真实宿主里 req 不一定是 Node 的 IncomingMessage：header 可能在 req.headers / req.raw.headers
      // / req.header() / req.get()，甚至是 Headers 实例。全都试一遍（实测：只读 req.headers 会拿不到 → 304 失效）
      const inm = readIfNoneMatch(req)
      if (inm && String(inm).split(',').map((s) => s.trim()).includes(etag)) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' })
        res.end()
        return
      }
      const body = Buffer.from(source, 'utf8')
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': String(body.length),
        ETag: etag,
        // no-cache = 允许缓存但每次都要回源校验：热更新后刷新页面立刻拿到新引擎
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      })
      if (method === 'HEAD') { res.end(); return }
      res.end(body)
    }
  }
}

async function handleStatus(req, res, diagnostics) {
  if ((req.method || 'GET') !== 'GET') {
    sendJSON(res, 405, { error: 'method_not_allowed', message: '期望 GET' })
    return
  }
  try {
    if (cache !== null && Date.now() < cache.expireAt) {
      // 自检信息实时计算（很便宜），不参与缓存
      sendJSON(res, 200, { ...cache.data, diagnostics: typeof diagnostics === 'function' ? diagnostics() : null })
      return
    }
    const ws = await readActiveWorkspace()
    const data = {
      activeWorkspace: ws ? ws.title : null,
      activeWorkspacePath: ws ? ws.path : null,
      updatedAt: new Date().toISOString()
    }
    cache = { data, expireAt: Date.now() + CACHE_TTL_MS }
    sendJSON(res, 200, { ...data, diagnostics: typeof diagnostics === 'function' ? diagnostics() : null })
  } catch (err) {
    sendJSON(res, 500, { error: 'status_failed', message: String((err && err.message) || err) })
  }
}

/**
 * 注册 /__mascot/asset（prefix）、/__mascot/status（exact），以及（可选）事件桥 /__mascot/events（exact）。
 * @param {import('@deepseek-ai/dsh-host-webserver').WebServer} webServer
 * @param {() => object} [diagnostics] 自检信息回调（随 status 返回，便于无浏览器环境核对注入状态）
 * @param {object} [bridge] 事件桥（见 bridge.mjs）；给了就一起挂 SSE 路由
 * @returns {() => void} disposer（热重载/卸载时清理全部路由）
 */
export function registerMascotRoutes(webServer, diagnostics, bridge, engine) {
  const disposers = []
  try {
    disposers.push(webServer.register({
      kind: 'prefix',
      path: ASSET_PREFIX,
      handler: (req, res) => handleAsset(req, res, ASSET_PREFIX)
    }))
    disposers.push(webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: (req, res) => handleStatus(req, res, diagnostics)
    }))
    if (bridge) disposers.push(webServer.register(createEventRoute(bridge, { path: EVENTS_PATH })))
    if (engine && typeof engine.render === 'function') disposers.push(webServer.register(createEngineRoute(engine)))
  } catch (err) {
    // 路由冲突（例如上一个实例没清理干净）不应让整个插件失败：回滚已注册的部分
    for (const dispose of disposers) { try { dispose() } catch {} }
    throw err
  }
  return () => { for (const dispose of disposers) { try { dispose() } catch {} } }
}

/** 从多种请求形态里取 If-None-Match（兼容 Node / koa / Express / fetch Headers）。 */
export function readIfNoneMatch(req) {
  if (!req) return undefined
  const pick = (h) => {
    if (!h) return undefined
    if (typeof h.get === 'function') return h.get('if-none-match') || undefined
    return h['if-none-match'] || h['If-None-Match']
  }
  const direct = pick(req.headers)
  if (direct) return direct
  if (req.raw) { const viaRaw = pick(req.raw.headers); if (viaRaw) return viaRaw }
  for (const fn of ['header', 'get']) {
    if (typeof req[fn] === 'function') {
      try { const v = req[fn]('if-none-match'); if (v) return v } catch {}
    }
  }
  return undefined
}