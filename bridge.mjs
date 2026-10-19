// bridge.mjs — 事件桥（v0.3）：把宿主 cordis 事件折成"AI 正在做什么"的粗粒度相位，用 SSE 推给页面。
//
// 为什么需要它：DOM 传感器是"猜"（看 data-streaming / data-variant 等标记，dsh 改版就失灵），
// 宿主事件是"被告知"（agent/status、tools/*、agent/turn-stopping……），既精确又稳定。
// 两者关系：**事件桥优先，DOM 传感兜底**（桥断流/未启用时引擎自动退回 DOM）。
//
// 事件都是可选依赖：老宿主缺某个事件时 try/catch 忽略，绝不让插件挂掉。
// 注意 waterfall 事件（tools/pre-execute、approval/request、user-questions/request）**必须把链交回去**，
// 否则会打断 dsh 自己的决策链。
//
// 设计要点：handle() 是纯归约（不碰 cordis），所以能在 tools/check-inject.mjs 里单测相位机；
// attach() 才负责把它挂到 ctx 上。

/** 相位全集（引擎侧 character.mjs 的 bridge.phases 必须覆盖这里的每一项，自检会校验）。 */
export const PHASES = ['idle', 'queued', 'thinking', 'working', 'tool', 'waiting', 'asking', 'helper', 'done', 'failed']

/** 会"闪一下再回去"的相位（引擎把这两个当瞬态处理）。 */
export const TRANSIENT_PHASES = ['done', 'failed']

/**
 * 创建相位归约器。
 * @param {{doneHoldMs?:number, failHoldMs?:number, now?:() => number}} [options]
 */
export function createActivityBridge(options = {}) {
  const now = options.now ?? (() => Date.now())
  const doneHoldMs = options.doneHoldMs ?? 4000
  const failHoldMs = options.failHoldMs ?? 5000

  const state = {
    phase: 'idle',
    tool: null,
    running: 0,
    helpers: 0,
    queued: 0,
    turn: 0,
    detail: '',
    seq: 0,
    updatedAt: now(),
    counters: {}
  }
  const listeners = new Set()
  let settleTimer = null

  const snapshot = () => ({
    phase: state.phase,
    tool: state.tool,
    running: state.running,
    helpers: state.helpers,
    queued: state.queued,
    turn: state.turn,
    detail: state.detail,
    seq: state.seq,
    updatedAt: new Date(state.updatedAt).toISOString()
  })

  function emit() {
    state.seq += 1
    state.updatedAt = now()
    const snap = snapshot()
    for (const fn of listeners) {
      try { fn(snap) } catch { /* 单个订阅者出错不影响其它订阅者 */ }
    }
  }

  function clearSettle() {
    if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null }
  }

  /** 进入某个相位；`holdMs` 到点后自动落回"还在跑就 working，否则 idle"。 */
  function enter(phase, holdMs) {
    clearSettle()
    if (state.phase !== phase) { state.phase = phase; emit(); return }
    // 相位没变也要 emit 一次（比如换个工具名），但避免"没变化却刷帧"
    if (phase === 'tool') emit()
  }

  function settleLater(holdMs) {
    clearSettle()
    settleTimer = setTimeout(() => {
      settleTimer = null
      state.phase = state.running > 0 ? 'working' : 'idle'
      emit()
    }, holdMs)
    if (typeof settleTimer.unref === 'function') settleTimer.unref()
  }

  /**
   * 纯归约：把一条宿主事件折进相位。
   * @param {string} name 事件名
   * @param {any} payload 事件负载
   * @returns {object} 归约后的快照
   */
  function handle(name, payload) {
    state.counters[name] = (state.counters[name] ?? 0) + 1
    switch (name) {
      case 'agent/status': {
        const running = payload?.status === 'running'
        state.running = Math.max(0, state.running + (running ? 1 : -1))
        if (running) enter('thinking')
        else if (state.phase !== 'done' && state.phase !== 'failed') enter(state.running > 0 ? 'working' : 'idle')
        else emit()
        return snapshot()
      }
      case 'agent/assistant-stream': {
        const type = payload?.frame?.type
        if (type === 'start') enter('thinking')
        else if (type === 'chunk') enter('working')
        else emit()
        return snapshot()
      }
      case 'tools/pre-execute': {
        const tool = payload?.exec?.name ?? null
        if (state.tool !== tool) { state.tool = tool; enter('tool') } else enter('tool')
        return snapshot()
      }
      case 'tools/result': {
        if (state.tool === null) state.tool = payload?.exec?.name ?? null
        enter(state.running > 0 ? 'thinking' : 'idle')
        return snapshot()
      }
      case 'agent/turn-stopping': {
        if (typeof payload?.turn === 'number') state.turn = payload.turn
        enter('done')
        settleLater(doneHoldMs)
        return snapshot()
      }
      case 'agent/error': {
        const err = payload?.error
        state.detail = String(err?.message ?? err ?? '').slice(0, 200)
        enter('failed')
        settleLater(failHoldMs)
        return snapshot()
      }
      case 'approval/request': {
        enter('waiting')
        return snapshot()
      }
      case 'user-questions/request': {
        enter('asking')
        return snapshot()
      }
      case 'subagent/start': {
        state.helpers += 1
        enter('helper')
        return snapshot()
      }
      case 'subagent/end': {
        state.helpers = Math.max(0, state.helpers - 1)
        if (state.helpers === 0 && state.phase === 'helper') enter(state.running > 0 ? 'working' : 'idle')
        else emit()
        return snapshot()
      }
      case 'agent/inbox/inserted': {
        state.queued += 1
        emit()
        return snapshot()
      }
      case 'agent/inbox/claimed': {
        state.queued = Math.max(0, state.queued - 1)
        emit()
        return snapshot()
      }
      default:
        return snapshot()
    }
  }

  /** 订阅相位变化；返回退订函数。 */
  function subscribe(fn) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  /** 手动设相位（自检/调试用；宿主事件之外也能驱动）。 */
  function force(phase, patch) {
    if (!PHASES.includes(phase)) return snapshot()
    if (patch && typeof patch === 'object') Object.assign(state, patch)
    enter(phase)
    return snapshot()
  }

  return { snapshot, subscribe, handle, force, state, counters: () => ({ ...state.counters }) }
}

/**
 * 把归约器挂到 cordis 上下文上。全部订阅都包 try/catch：老宿主缺事件不该让插件失效。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<typeof createActivityBridge>} bridge
 * @returns {() => void} 退订器
 */
export function attachActivityBridge(ctx, bridge) {
  const disposers = []
  const on = (name, listener) => {
    try {
      const dispose = ctx.on(name, listener)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch { /* 该事件在本宿主不存在：忽略 */ }
  }

  // —— 持续状态 ——
  on('agent/status', (payload) => bridge.handle('agent/status', payload))
  on('agent/assistant-stream', (payload) => bridge.handle('agent/assistant-stream', payload))
  on('agent/inbox/inserted', (payload) => bridge.handle('agent/inbox/inserted', payload))
  on('agent/inbox/claimed', (payload) => bridge.handle('agent/inbox/claimed', payload))
  on('subagent/start', (info) => bridge.handle('subagent/start', info))
  on('subagent/end', (info) => bridge.handle('subagent/end', info))
  // —— 一次性事件 ——
  on('agent/error', (payload) => bridge.handle('agent/error', payload))
  on('agent/turn-stopping', (payload) => bridge.handle('agent/turn-stopping', payload))
  on('tools/result', (exec, result) => bridge.handle('tools/result', { exec, result }))
  // —— waterfall：必须把链交回去（哪怕自己出错） ——
  on('tools/pre-execute', (exec, next) => {
    try { bridge.handle('tools/pre-execute', { exec }) } catch { /* 观察者不参与决策 */ }
    return typeof next === 'function' ? next() : undefined
  })
  on('approval/request', (request, next) => {
    try { bridge.handle('approval/request', { request }) } catch { /* 同上 */ }
    return typeof next === 'function' ? next() : undefined
  })
  on('user-questions/request', (request, next) => {
    try { bridge.handle('user-questions/request', { request }) } catch { /* 同上 */ }
    return typeof next === 'function' ? next() : undefined
  })

  return () => {
    for (const dispose of disposers) { try { dispose() } catch { /* 已释放 */ } }
    disposers.length = 0
  }
}

/**
 * 构造 SSE 路由（交给 webServer.register）。
 * 首帧是快照，之后每次相位变化推一帧；25s 一次 `: ping` 保活；客户端断开自动退订。
 * @param {ReturnType<typeof createActivityBridge>} bridge
 * @param {{path?:string, pingMs?:number}} [options]
 */
export function createEventRoute(bridge, options = {}) {
  const path = options.path ?? '/__mascot/events'
  const pingMs = options.pingMs ?? 25000
  return {
    kind: 'exact',
    path,
    handler(req, res) {
      if ((req.method || 'GET') !== 'GET') {
        res.writeHead(405, { Allow: 'GET' })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      // retry 让 EventSource 断线后按我们的节奏重连
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify(bridge.snapshot())}\n\n`)

      const unsubscribe = bridge.subscribe((snap) => {
        try { res.write(`data: ${JSON.stringify(snap)}\n\n`) } catch { /* 客户端已断开 */ }
      })
      const ping = setInterval(() => {
        try { res.write(': ping\n\n') } catch { /* 客户端已断开 */ }
      }, pingMs)
      if (typeof ping.unref === 'function') ping.unref()

      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ping)
        try { unsubscribe() } catch { /* 已退订 */ }
        try { res.end() } catch { /* 已结束 */ }
      }
      req.on('close', close)
      req.on('error', close)
      res.on('close', close)
    }
  }
}
