// browser-stub.mjs — 给注入引擎用的最小浏览器环境（只在 Node 里跑测试用，不进插件运行期）
//
// 目的：让 tools/smoke-test.mjs 能**真正执行**注入的那段 IIFE，而不是只做语法检查。
// 因此这里实现了引擎实际用到的 API 子集：元素/类名/样式、事件（带冒泡）、
// localStorage、matchMedia、MutationObserver、requestAnimationFrame、
// Image、EventSource（可手动喂帧）、AudioContext（可断言是否出声）。
// 刻意不实现 HTML 解析：引擎只有设置面板用 innerHTML，smoke test 只验证"打开面板不抛错"。

class ClassList {
  constructor(el) { this.el = el; this.set = new Set() }
  add(...names) { for (const n of names) if (n) this.set.add(n); this.sync() }
  remove(...names) { for (const n of names) this.set.delete(n); this.sync() }
  contains(name) { return this.set.has(name) }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force
    if (on) this.set.add(name); else this.set.delete(name)
    this.sync()
    return on
  }
  sync() { this.el._className = [...this.set].join(' ') }
  replaceFrom(className) {
    this.set = new Set(String(className || '').split(/\s+/).filter(Boolean))
    this.el._className = String(className || '')
  }
}

export class StubElement {
  constructor(tagName, owner) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = owner
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.style = {}
    this.dataset = {}
    this.listeners = new Map()
    this.textContent = ''
    this._innerHTML = ''
    this._className = ''
    this.classList = new ClassList(this)
    this.id = ''
    this.alt = ''
    this.draggable = false
    this.src = ''
    this.paused = true
    this.currentTime = 0
    this.readyState = 0
    this.error = null
    this.muted = false
    this.loop = false
    this.playsInline = false
    this.preload = ''
    this.volume = 1
    this.playCalls = 0
    this.pauseCalls = 0
  }

  get className() { return this._className }
  set className(value) { this.classList.replaceFrom(value) }

  get innerHTML() { return this._innerHTML }
  set innerHTML(value) { this._innerHTML = String(value); this.children = [] }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  contains(other) { return other === this || this.children.includes(other) }

  // 真实浏览器里 src 属性与 property 是联动的：桩也要同步，否则引擎里 getAttribute('src') 比较永远为真
  get src() { return this.attributes.src === undefined ? '' : this.attributes.src }
  set src(v) { this.attributes.src = String(v) }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name] }
  removeAttribute(name) { delete this.attributes[name] }
  hasAttribute(name) { return this.attributes[name] !== undefined }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
  listenerCount() { let n = 0; for (const set of this.listeners.values()) n += set.size; return n }

  /** 极简选择器：只支持引擎用到的那几种（.cls / #id / [attr] / [attr="v"] / tag / 逗号列表）。 */
  matches(selector) {
    return String(selector).split(',').some((part) => {
      const s = part.trim()
      if (!s) return false
      if (s.startsWith('.')) return this.classList.contains(s.slice(1))
      if (s.startsWith('#')) return this.id === s.slice(1)
      if (s.startsWith('[')) {
        const m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(s)
        if (!m) return false
        const value = this.attributes[m[1]]
        return m[2] === undefined ? value !== undefined : value === m[2]
      }
      return this.tagName === s.toUpperCase()
    })
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }
  querySelectorAll(selector, out = []) {
    for (const child of this.children) {
      if (child.matches(selector)) out.push(child)
      child.querySelectorAll(selector, out)
    }
    return out
  }
  closest(selector) {
    let node = this
    while (node) { if (node.matches(selector)) return node; node = node.parentNode }
    return null
  }
  getBoundingClientRect() {
    const w = Number(this.style.width) || Number(this._rectW) || 150
    const h = Number(this.style.height) || Number(this._rectH) || 200
    const left = Number.parseFloat(this.style.left || this._left) || 0
    const top = Number.parseFloat(this.style.top || this._top) || 0
    return { left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top }
  }
  /** 测试里手动设定尺寸/位置（真实浏览器里由布局算）。 */
  setRect({ width, height, left, top }) {
    if (width !== undefined) this._rectW = width
    if (height !== undefined) this._rectH = height
    if (left !== undefined) this._left = left
    if (top !== undefined) this._top = top
  }
  get offsetWidth() { return this.getBoundingClientRect().width }
  get offsetHeight() { return this.getBoundingClientRect().height }
  get offsetLeft() { return this.getBoundingClientRect().left }
  get offsetTop() { return this.getBoundingClientRect().top }

  // 媒体元素最小行为：引擎的懒播放/看门狗/垫底立绘逻辑都依赖它
  play() { this.paused = false; this.playCalls++; return Promise.resolve() }
  pause() { this.paused = true; this.pauseCalls++ }
  load() { this.readyState = 1 }
  get pausedState() { return this.paused }

  /** 事件派发：从自身向上冒泡（够引擎用，不做捕获阶段的完整语义）。 */
  dispatch(type, event = {}) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event }
    let node = this
    while (node) {
      for (const fn of node.listeners.get(type) || []) fn.call(node, ev)
      node = node.parentNode
    }
    return ev
  }
}

class StubMutationObserver {
  constructor(callback) { this.callback = callback; this.targets = [] }
  observe(target, options) { this.targets.push({ target, options }) }
  disconnect() { this.targets = [] }
  /** 测试里手动触发（记录到的变更不重要，引擎只用到"有变化就重算"）。 */
  trigger() { this.callback([], this) }
}

class StubEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.onmessage = null
    this.onopen = null
    this.onerror = null
    this.closed = false
    StubEventSource.instances.push(this)
  }
  close() { this.closed = true; this.readyState = 2 }
  /** 测试里喂一帧（模拟宿主推来的相位快照）。 */
  emit(data) {
    if (this.closed) return
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}
StubEventSource.instances = []

class StubAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; StubAudioContext.instances.push(this) }
  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}
      },
      connect() {}
    }
  }
  createOscillator() {
    return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  resume() { this.state = 'running' }
}
StubAudioContext.instances = []

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)) },
    removeItem: (k) => { map.delete(String(k)) },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size },
    _map: map
  }
}

/**
 * 造一个最小浏览器环境。
 * @param {{width?:number, height?:number, dark?:boolean, reducedMotion?:boolean}} [options]
 */
export function createBrowserStub(options = {}) {
  // 每次造桩都清空"全局实例表"：否则多轮用例会拿到上一轮已 close 的实例（冒烟测试踩过）
  StubEventSource.instances = []
  StubAudioContext.instances = []
  const document = new StubElement('#document')
  document.documentElement = new StubElement('html', document)
  document.body = new StubElement('body', document)
  document.appendChild(document.documentElement)
  document.appendChild(document.body)
  document.hidden = false
  document.activeElement = null
  document.visibilityState = 'visible'
  document.createElement = (tag) => new StubElement(tag, document)
  document.createTextNode = (text) => { const el = new StubElement('#text', document); el.textContent = text; return el }
  document.getElementById = (id) => (document.body.matches(`#${id}`) ? document.body : document.body.querySelector(`#${id}`)) ||
    (document.documentElement.matches(`#${id}`) ? document.documentElement : document.documentElement.querySelector(`#${id}`))
  document.addEventListener = StubElement.prototype.addEventListener.bind(document)
  document.removeEventListener = StubElement.prototype.removeEventListener.bind(document)

  const rafQueue = []
  const observers = []
  const window = {
    innerWidth: options.width ?? 1280,
    innerHeight: options.height ?? 800,
    devicePixelRatio: 1,
    listeners: new Map(),
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn) },
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) },
    dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, ...event }) },
    matchMedia(query) {
      const matches = options.reducedMotion === true && query.includes('reduced-motion')
      return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    }
  }
  window.window = window
  // 引擎里对 window.* 的访问（EventSource / AudioContext / 定时器…）也要能用
  Object.assign(window, {
    EventSource: StubEventSource,
    AudioContext: StubAudioContext,
    MutationObserver: class extends StubMutationObserver {
      constructor(cb) { super(cb); observers.push(this) }
    },
    Image: class { constructor() { this.src = '' } },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length },
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    getComputedStyle: (el) => ({ animationName: el?.style?.animation ? String(el.style.animation).split(/\s+/)[0] : 'none' }),
    fetch: async () => ({ ok: true, json: async () => ({ activeWorkspace: 'stub-workspace' }) }),
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
    console
  })

  const documentMatchesDark = () => !!options.dark

  const sandbox = {
    window,
    document,
    navigator: { language: 'zh-CN', userAgent: 'stub' },
    location: { protocol: 'http:', host: '127.0.0.1:3080', href: 'http://127.0.0.1:3080/' },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length },
    cancelAnimationFrame() {},
    matchMedia: window.matchMedia.bind(window),
    getComputedStyle: (el) => ({ animationName: el?.style?.animation ? String(el.style.animation).split(/\s+/)[0] : 'none', animationDuration: '0s' }),
    MutationObserver: class extends StubMutationObserver {
      constructor(cb) { super(cb); observers.push(this) }
    },
    Image: class { constructor() { this.src = '' } },
    EventSource: StubEventSource,
    AudioContext: StubAudioContext,
    fetch: async () => ({ ok: true, json: async () => ({ activeWorkspace: 'stub-workspace', diagnostics: { version: 'test' } }) }),
    // 供引擎查询"暗色主题"用的选择器：由桩决定命中与否
    __darkMatch: documentMatchesDark
  }
  // 引擎用 document.querySelector(CFG.darkSelector) 判断深色；这里按 options.dark 造一个假节点
  const realQuery = StubElement.prototype.querySelector
  document.querySelector = function (selector) {
    if (options.dark && String(selector).includes('data-ds-dark-theme')) {
      const fake = new StubElement('body', document)
      fake.setAttribute('data-ds-dark-theme', '')
      return fake
    }
    return realQuery.call(this, selector)
  }
  document.querySelectorAll = function (selector) { return StubElement.prototype.querySelectorAll.call(this, selector) }

  return {
    sandbox,
    document,
    window,
    observers,
    EventSource: StubEventSource,
    AudioContext: StubAudioContext,
    /** 跑掉排队的 rAF（引擎的视线跟随/惯性滑动都靠它）。 */
    flushRaf(times = 4) {
      for (let i = 0; i < times; i++) {
        const batch = rafQueue.splice(0, rafQueue.length)
        for (const fn of batch) fn(16 * (i + 1))
      }
    },
    /** 便捷查询：按 id 找深色假节点之外的正常节点。 */
    root() { return document.body.querySelector('#dsh-whale-girl-root') }
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
