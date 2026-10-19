// smoke-test.mjs — 运行时冒烟测试：在 Node 里用最小浏览器桩**真正执行**注入的引擎。
//
// 与 check-inject.mjs 的分工：
//   check-inject = 静态门禁（产物结构、素材、路由规则、数据模型、从产物里抽函数做纯逻辑测试）
//   smoke-test   = 运行时门禁（引擎能不能跑起来、状态机/覆写/事件桥/生命周期是否真的工作）
//
// 两种注入形态都跑一遍（§20.4「引擎改资产文件」）：
//   inline   —— 单段 <script>（配置/角色/引擎全在页面里）
//   external —— 数据 <script> + <script src=/__mascot/engine.js>（引擎单独缓存）
// 断言的都是"用户能感知的行为"：引擎不抛错、根节点/命中层就位、待机用会动的底图、
// setMood 切表情、说话出气泡、台词覆写真的影响点击台词、事件桥帧让来源变 bridge、
// {tool} 被替换、隐藏/唤回、_teardown 清理干净。
import vm from 'node:vm'
import { createBrowserStub, sleep } from './browser-stub.mjs'
import { renderInject, renderCompact, renderClientScript } from '../engine.mjs'
import config from '../mascot.config.mjs'
import character from '../character.mjs'

// 眨眼间隔在真机上是 2.2~6.2 秒，冒烟测试等不起：这里压到几百毫秒（只影响"眼睛会动"那组断言）。
// 必须在渲染注入片段之前改，配置是被 JSON 序列化进产物的。
const peekActForTest = (character.acts || []).find((a) => a.id === 'peekEdge')
if (peekActForTest && peekActForTest.eyeLife) {
  peekActForTest.eyeLife.gapMs = [400, 700]
  peekActForTest.eyeLife.blinkMs = 40
  peekActForTest.frameMs = 80          // 三帧开头快进，省掉真机上的 2.1 秒
  // 微摆真机是 0.075Hz（一个周期 13 秒），0.5 秒窗口内几乎看不出变化 → 测试里调快，
  // 让"头/视线在慢慢摆"这条断言在几百毫秒内就能判定（真实频率由静态门禁守）。
  if (peekActForTest.pose) peekActForTest.pose.swayHz = 1.2
}

const BASE = '/__mascot/asset/'
const VER = 'smoke'
const ENGINE_PATH = '/__mascot/engine.js'

const inlineHtml = renderInject(BASE, VER)
const compactHtml = renderCompact(BASE, VER, ENGINE_PATH)
const clientScript = renderClientScript(BASE, VER)
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(inlineHtml)?.[1]
const dataScript = /<script id="dsh-whale-girl-data">([\s\S]*?)<\/script>/.exec(compactHtml)?.[1]

const failures = []
let uncaughtCount = 0
let currentTag = ''
function check(ok, label, detail) {
  if (!ok) failures.push(`  FAIL [${currentTag}] ${label}${detail ? ` — ${detail}` : ''}`)
}

// 兜住未捕获异常/未处理拒绝：**立刻大声失败**，绝不静默挂着（引擎的定时器会把进程吊住）
process.on('uncaughtException', (err) => {
  uncaughtCount++
  console.error('\n✗ 冒烟测试未捕获异常：', err && err.stack ? err.stack : err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  uncaughtCount++
  console.error('\n✗ 冒烟测试未处理的 Promise 拒绝：', err && err.stack ? err.stack : err)
  process.exit(1)
})

function stubPlay(el) {
  return function () { el.paused = false; el.playCalls++; return Promise.resolve() }
}

/**
 * 跑一种注入形态的完整行为断言。
 * @param {{mode: 'inline'|'external', locale?: string, dropLocaleKey?: string}} options
 * @returns {Promise<number>} 该形态通过的断言数
 */
async function runCase(options) {
  const mode = options.mode
  currentTag = options.locale ? `${mode}/${options.locale}${options.dropLocaleKey ? ' 缺' + options.dropLocaleKey : ''}` : mode
  let passed = 0
  const ok = (cond, label, detail) => { check(cond, label, detail); if (cond) passed++ }

  const stub = createBrowserStub({ width: 1280, height: 800 })
  const context = vm.createContext({ ...stub.sandbox })
  if (options.locale) context.window.__DSH_LOCALE__ = options.locale   // 模拟宿主/浏览器语言

  // —— 0) 按形态执行脚本（external 模拟浏览器的执行顺序：数据先、引擎后）——
  try {
    if (mode === 'inline') {
      vm.runInContext(inlineScript, context, { filename: 'dgw-inline.js' })
    } else {
      vm.runInContext(dataScript, context, { filename: 'dgw-data.js' })
      // 故意挖掉一条译文，验证"缺译文回落中文"这条兜底
      if (options.dropLocaleKey) delete context.window.__DGW_DATA__.char.locales.en[options.dropLocaleKey]
      vm.runInContext(clientScript, context, { filename: 'dgw-engine.js' })
    }
  } catch (err) {
    check(false, '引擎执行不抛错', err && err.message)
    return passed
  }
  ok(true, '引擎执行不抛错')

  const root = stub.root()
  ok(!!root, '挂载出 #dsh-whale-girl-root')
  ok(/dgw-mood-idle/.test(root?.className || ''), `待机类名正确（${root?.className || ''}）`)
  const hit = root?.querySelector('.dgw-hit')
  ok(!!hit, '命中层存在（透明留白不吃点击）')
  ok(hit?.getAttribute('tabindex') === '0' && hit?.getAttribute('role') === 'button', '命中层可 Tab 聚焦且是 button 语义')
  const img = root?.querySelector('.dgw-img')
  const video = root?.querySelector('.dgw-video')
  ok(!!img, '立绘元素存在')
  ok(!!video, '待机动画视频元素存在')

  const api = context.window.__dshWhaleGirl
  ok(!!api && typeof api.setMood === 'function', '调试钩子 window.__dshWhaleGirl 可用')
  if (!api) return passed

  // —— 1) 诊断信息完整（排查"为什么不动"靠它）——
  const motion0 = api.motion()
  ok(typeof motion0.shouldMove === 'boolean', 'motion().shouldMove 存在')
  ok(motion0.sense && 'source' in motion0.sense, 'motion().sense 报告状态来源')
  ok(motion0.video && 'paused' in motion0.video && 'ok' in motion0.video, 'motion().video 报告播放状态')
  ok(motion0.a11y && motion0.a11y.keyboard === true, 'motion().a11y 报告键盘可达')
  ok(motion0.dialogue && typeof motion0.dialogue.recent === 'number', 'motion().dialogue 报告台词状态')

  // —— 2) 待机是"会动的底图"：视频一旦就绪就顶上，失败则退回立绘 ——
  ok(api.motion().video.ok === false, '视频还没就绪时 video.ok 为 false')
  ok(!img.classList.contains('dgw-off'), '视频未就绪时立绘可见（垫底，不会看到卡住的帧）')
  video.dispatch('loadeddata')
  ok(api.motion().video.ok === true, 'loadeddata 后 video.ok 变 true')
  ok(!img.classList.contains('dgw-off'), '视频尚未播放时仍然留着垫底立绘')
  video.play = stubPlay(video)
  video.dispatch('playing')
  await sleep(30)
  ok(img.classList.contains('dgw-off'), 'playing 之后视频接管画面（垫底立绘淡出）')

  // —— 3) 情绪切换 ——
  ok(api.setMood('dizzy') === 'dizzy', 'setMood(dizzy) 生效')
  ok(/dgw-mood-dizzy/.test(root.className), '根节点类名跟随情绪')
  ok(api.motion().visible.includes('dizzy.png'), `切到头晕立绘（${api.motion().visible}）`)
  api.setMood('thinking')
  ok(api.motion().visible.includes('thinking.png'), '切到思考立绘（有自己的静帧语义）')
  api.setMood('idle')
  ok(/dgw-mood-idle/.test(root.className), '能回到待机')

  // —— 4) 说话：气泡 + 逐字 ——
  api.speak('你好呀，我是测试台词')
  await sleep(120)
  const bubble = root.querySelector('.dgw-bubble')
  ok(!!bubble, '说话会创建气泡元素')
  ok(String(bubble?.textContent || '').length > 0, `气泡逐字显示中（${JSON.stringify(bubble?.textContent || '')}）`)
  ok(bubble?.getAttribute('role') === 'status' && bubble?.getAttribute('aria-live') === 'polite', '气泡对屏幕阅读器可见')
  await sleep(400)
  ok(String(bubble.textContent).includes('测试台词'), '气泡把整句说完')

  // —— 5) 事件桥：帧到达后状态来源变成 bridge ——
  ok(api.motion().sense.source !== 'bridge', '没有帧时状态来源不是 bridge（DOM 兜底）')
  const es = stub.EventSource.instances[0]
  ok(!!es, '引擎建立了 EventSource 连接')
  ok(String(es?.url || '').includes('/__mascot/events') && !String(es?.url || '').includes('/asset/'), `事件桥 URL 挂在 origin 上、不在素材目录下（${es?.url}）`)
  es.emit({ phase: 'tool', tool: 'pwsh', seq: 1, turn: 2, running: 1, helpers: 0, queued: 0 })
  await sleep(160)
  const m1 = api.motion()
  ok(m1.sense.source === 'bridge' && m1.sense.phase === 'tool', `帧到达后来源为 bridge / 相位 tool（${m1.sense.source}/${m1.sense.phase}）`)
  ok(m1.sense.tool === 'pwsh', '工具名已记录')
  // 相位台词受全局冷却约束（刚说过就不抢话）——这里改用显式说话验证 {tool} 插值
  await sleep(1600)   // 让开屏问候先说完（它只在启动后 1.4s 说一次，会抢走气泡）
  api.speak('正在跑 {tool} 呢')
  await sleep(800)    // 逐字显示（26 字/秒）要把整句打完
  ok(String(bubble.textContent).includes('pwsh'), `{tool} 被替换成真实工具名（${JSON.stringify(bubble.textContent)}）`)
  ok(!String(bubble.textContent).includes('{'), '气泡里不会残留未替换的占位符')
  ok(/dgw-mood-working/.test(root.className), 'tool 相位映射到"工作中"')
  es.emit({ phase: 'done', tool: 'pwsh', seq: 2, turn: 2 })
  await sleep(60)
  ok(/dgw-mood-success/.test(root.className), 'done 相位闪一下完成表情')

  // —— 6) 台词本地覆写真的影响说话 ——
  const stage = root.querySelector('.dgw-stage')
  stage.setRect({ width: 150, height: 200, left: 0, top: 0 })   // 桩里手动给布局尺寸
  api.dialogue('zone:body', ['自定义：戳肚子的台词'])
  ok(api.dialogue('zone:body').includes('自定义'), '调试钩子能写入并读回覆写')
  api.dialogue('act:jog', ['自定义：动作台词'])
  api.act('jog')
  await sleep(220)
  ok(String(bubble.textContent).includes('自定义'), `台词覆写会真的被说出来（${JSON.stringify(bubble.textContent)}）`)
  api.stopAct()
  api.dialogue('zone:body', null)
  ok(!api.dialogue('zone:body').includes('自定义'), '恢复默认后覆写消失')

  // —— 6b) 语言包：覆写 > 语言包 > 中文 ——
  const i18n = api.motion().i18n
  if (options.locale === 'en') {
    ok(i18n.lang === 'en', `界面语言被识别为英文（lang=${i18n.lang}，探测值=${i18n.detected}）`)
    ok(Array.isArray(i18n.packs) && i18n.packs.includes('en'), `诊断里能看到可用语言包（${i18n.packs}）`)
    bubble.textContent = ''
    hit.dispatch('click', { clientX: 75, clientY: 150, button: 0 })
    await sleep(220)
    // 这一条只在译文完整时成立；故意挖掉 zone:body 译文的用例走下面的"回落中文"断言
    // v0.13.6：单击不再触发台词，所以改用"有效文本"（dialogueText 与说话走同一条 poolFor 链）
    if (!options.dropLocaleKey) ok(!/[\u4e00-\u9fff]/.test(api.dialogue('zone:body')), `英文模式下台词有效文本无中文（${api.dialogue('zone:body').slice(0, 24)}）`)
    // 用户覆写优先于语言包：本地改过的台词不该被语言切换覆盖
    await sleep((config.angryWindowMs || 4000) + 250)   // 等连点计数窗口过去，否则第 3 次点击会被判成 think 分支
    api.dialogue('zone:body', ['自定义中文优先'])
    ok(api.dialogue('zone:body').includes('自定义'), `本地覆写优先于语言包（${api.dialogue('zone:body').slice(0, 20)}）`)
    api.dialogue('zone:body', null)
  }
  if (options.dropLocaleKey) {
    ok(/[\u4e00-\u9fff]/.test(api.dialogue('zone:body')), `缺译文时回落中文而不是哑巴（${api.dialogue('zone:body').slice(0, 20)}）`)
  }

  // —— 6c) 视线/眼神跟随（伪 3D 转头）——
  {
    const gazeEl = root.querySelector('.dgw-gaze')
    const animEl = root.querySelector('.dgw-anim')
    ok(!!gazeEl && !!animEl, 'gaze 图层与 anim 图层都存在（分层，互不抢 transform）')
    ok(api.motion().gaze.yaw === 0, '没动鼠标时视线是正的（不自己乱转）')
    const r = root.getBoundingClientRect()
    stub.document.dispatch('mousemove', { clientX: r.left - 600, clientY: r.top + r.height * 0.3 })
    stub.flushRaf(6)
    await sleep(30)
    const left = api.motion().gaze
    ok(left.yaw < 0, `鼠标在左边 → 朝左转头（yaw=${left.yaw}）`)
    stub.document.dispatch('mousemove', { clientX: r.left + r.width + 600, clientY: r.top + r.height * 0.3 })
    stub.flushRaf(6)
    await sleep(30)
    const right = api.motion().gaze
    ok(right.yaw > 0, `鼠标在右边 → 朝右转头（yaw=${right.yaw}）`)
    const maxYaw = Math.abs(config.gaze.maxYawDeg)
    ok(Math.abs(right.yaw) <= maxYaw + 0.01 && Math.abs(left.yaw) <= maxYaw + 0.01, `角度不超上限（|yaw| ≤ ${maxYaw}°）`)
    stub.document.dispatch('mousemove', { clientX: r.left + r.width / 2, clientY: r.top - 600 })
    stub.flushRaf(6)
    await sleep(30)
    ok(api.motion().gaze.pitch > 0, `鼠标在上方 → 抬头（pitch=${api.motion().gaze.pitch}）`)
    ok(String(gazeEl.style.transform).includes('rotateY('), '转头写在 gaze 图层上')
    ok(!String(animEl.style.transform).includes('rotateY'), 'anim 图层没有被写 transform（浮动动画不会被覆盖）')
    ok(api.motion().gaze.enabled === true, '诊断里报告视线跟随已启用')
  }

  // —— 6d) 休闲动作（动态待机动作）——
  {
    ok(api.act() === null, '没有动作在跑时 act() 返回 null')
    const started = api.act('jog')
    ok(started === true, 'act("jog") 能启动原地跑步')
    stub.flushRaf(6)
    await sleep(60)
    const gz = root.querySelector('.dgw-gaze')
    const moved = String(gz.style.transform)
    ok(moved.includes('rotateY(') && moved.includes('scale('), '动作姿态写在 gaze 图层上（与视线合成）')
    const mAct = api.motion().act
    ok(mAct.id === 'jog' && mAct.remaining > 0, `诊断报告当前动作（${mAct.id}, 剩余 ${mAct.remaining}ms）`)
    ok(typeof mAct.edge.side === 'string' || mAct.edge.side === null, '诊断报告贴边状态')
    // 用户一操作就打断
    hit.dispatch('mousedown', { button: 0, clientX: 10, clientY: 10 })   // onDown 绑在 stage 上（靠冒泡）
    ok(api.act() === null, '鼠标按下立刻打断休闲动作')
    // 缺素材的动作不许启动
    ok(api.act('fan') === false, '标记 needsArt 的动作（折扇）在素材到位前不启动')
    // 位置条件：贴左边才抽得到"扒墙"
    const r2 = root.getBoundingClientRect()
    // 扒墙是"状态保持"型：不在边缘会立即结束 —— 先拖到左边缘再手动触发
    hit.dispatch('mousedown', { button: 0, clientX: 500, clientY: 400 })
    stub.document.dispatch('mousemove', { clientX: -900, clientY: 400 })
    await sleep(30)
    stub.document.dispatch('mouseup', {})
    await sleep(80)
    ok(api.act('peekEdge') === true, '扒墙偷看可以手动触发（位置条件由调度器把关）')
    // 帧序列：素材给姿势、引擎给节奏（T5 接入）
    stub.flushRaf(4)
    await sleep(80)
    const peekAct = api.motion().act
    ok(peekAct.id === 'peekEdge' && /act-peek-0\d\.png/.test(String(peekAct.frame)), `扒墙动作在按帧轮播（${peekAct.frame}）`)
    const peekGaze = root.querySelector('.dgw-gaze')
    ok(/scale\(-/.test(String(peekGaze.style.transform)), `贴左边时镜像（v0.13.4 方向修正）（${String(peekGaze.style.transform).slice(0, 48)}）`)
    ok(root.querySelector('.dgw-img').src.includes('act-peek-'), '画面确实换成了动作帧素材')

    // 贴边停留即触发（v0.13.3）：AI 正在干活也照演；左右两侧都要生效
    api.stopAct()
    es.emit({ phase: 'tool', tool: 'pwsh', running: 1, helpers: 0, queued: 0, seq: 21 })   // 故意让 AI 处于“干活中”
    await sleep(80)
    ok(api.motion().mood === 'working' || api.motion().sense.phase === 'tool', 'AI 处于干活状态（用来验证门禁已放开）')
    const dragTo = async (clientX) => {
      hit.dispatch('mousedown', { button: 0, clientX: 500, clientY: 400 })
      stub.document.dispatch('mousemove', { clientX, clientY: 400 })
      await sleep(30)
      stub.document.dispatch('mouseup', {})
    }
    await dragTo(-900)                       // 拖到最左
    await sleep(900)
    const t1 = api.motion().act
    ok(t1.id === null && t1.edge.side === 'left' && t1.edgeDwellMs > 300, `左侧刚贴边只计时不演（停留 ${t1.edgeDwellMs}ms）`)
    await sleep(1900)
    ok(api.motion().act.id === 'peekEdge', `左侧停留 2 秒即触发，AI 在干活也照演（实际 ${api.motion().act.id}）`)
    stub.flushRaf(4)
    ok(/scale\(-/.test(String(root.querySelector('.dgw-gaze').style.transform)), '左边缘镜像（修正方向：让她朝屏幕内看）')
    api.stopAct()
    await dragTo(2400)                       // 换到最右
    await sleep(2600)
    const t2 = api.motion().act
    ok(t2.id === 'peekEdge' && t2.edge.side === 'right', `右侧同样触发（换边重新计时，实际 ${t2.id}/${t2.edge.side}）`)
    stub.flushRaf(4)
    ok(!/scale\(-/.test(String(root.querySelector('.dgw-gaze').style.transform)), '右边缘用原图（不镜像）')
    // 保持态只由"点她 / 拖离边缘"结束（v0.13.5）
    stub.document.dispatch('mouseup', {})            // 页面别处松开鼠标
    await sleep(120)
    ok(api.motion().act.id === 'peekEdge', '页面别处松鼠标不会结束保持态')
    es.emit({ phase: 'tool', tool: 'pwsh', running: 1, helpers: 0, queued: 0, seq: 31 })   // AI 开始干活
    await sleep(160)
    ok(api.motion().act.id === 'peekEdge', 'AI 状态变化也不会结束保持态')
    // 注："点她会结束"已由前面"鼠标按下立刻打断休闲动作"那条断言覆盖（onDown 绑在 stage 上）
    await sleep(2600)
    ok(api.motion().act.id === 'peekEdge', '贴在边缘时状态保持（一直演，不按时长收工）')
    await dragTo(600)   // 移回中间
    await sleep(700)
    ok(api.motion().act.id === null, '移离边缘后动作结束')
    api.stopAct()

    api.stopAct()
    ok(api.act() === null, 'stopAct() 能立即中止')
  }

  // —— 6e) 贴边保持态里的"眼睛会动"（眨眼 + 待机式微摆，v0.15.0）——
  {
    const dragTo = async (clientX) => {
      hit.dispatch('mousedown', { button: 0, clientX: 500, clientY: 400 })
      stub.document.dispatch('mousemove', { clientX, clientY: 400 })
      await sleep(30)
      stub.document.dispatch('mouseup', {})
    }
    await dragTo(-900)                     // 拖到最左 → 贴边停留后进入保持态
    await sleep(2600)
    ok(api.motion().act.id === 'peekEdge', `贴左边进入保持态（实际 ${api.motion().act.id}）`)
    const eye0 = api.motion().eye
    ok(!!eye0 && eye0.base === 'act-peek-03.png', '保持态动作声明了眨眼基准帧（保持态停住的那一帧）')
    ok(!!eye0 && eye0.blinkFile === 'act-peek-03-blink.png', '保持态动作声明了闭眼帧素材')

    // 帧序列播完停在基准帧上 → 眼睛的"待机"才开始（前面的帧眼位不同，不能眨眼）
    for (let i = 0; i < 12; i++) { stub.flushRaf(3); await sleep(30) }
    const eyeRest = api.motion().eye
    ok(eyeRest.resting === true, '帧序列播完停在最后一帧（进入"眼睛待机"）')
    ok(api.motion().act.frame === 'act-peek-03.png', `停在基准帧上（${api.motion().act.frame}）`)
    // nextInMs 是"距离下次眨眼还有多久"，采样正好落在到点那一刻时会是 0（边界情况，不是没排期）
    ok(eyeRest.nextInMs >= 0 && eyeRest.blinking === false, `已经排好下一次眨眼（${eyeRest.nextInMs}ms 后）`)

    // 待机式微摆：头带着眼睛慢慢晃 → 同一姿势下 rotateY 会随时间变化
    const yawOf = () => {
      const m = /rotateY\((-?[\d.]+)deg\)/.exec(String(root.querySelector('.dgw-gaze').style.transform))
      return m ? Number(m[1]) : null
    }
    const yawA = yawOf()
    await sleep(260); stub.flushRaf(3); await sleep(260); stub.flushRaf(3)
    const yawB = yawOf()
    ok(yawA !== null && yawB !== null && Math.abs(yawB - yawA) > 0.2,
      `保持态里视线/头在慢慢摆（rotateY ${yawA}° → ${yawB}°）`)

    // 手动眨一次：画面切到闭眼帧，blinkMs 之后切回来
    const blinkFile = api.motion().eye.blinkFile
    ok(api.blink() === true, 'blink() 能立刻眨一次眼')
    ok(api.motion().eye.blinking === true, '诊断里报告"正在眨眼"')
    ok(img.src.includes(blinkFile.replace('.png', '')), `画面确实换成了闭眼帧（${img.src.split('/').pop()}）`)
    await sleep(120); stub.flushRaf(3); await sleep(60); stub.flushRaf(3)
    ok(api.motion().eye.blinking === false, '眨完自动回到睁眼帧（不会卡在闭眼）')
    ok(!img.src.includes(blinkFile.replace('.png', '')), '闭眼帧已经换下去了')

    // 自动眨眼：间隔（测试里被压到几十毫秒）到了就自己眨
    let autoBlinked = false
    for (let i = 0; i < 40 && !autoBlinked; i++) {
      stub.flushRaf(3)
      await sleep(25)
      if (api.motion().eye && api.motion().eye.blinking) autoBlinked = true
    }
    ok(autoBlinked, `到点会自己眨眼（间隔 ${JSON.stringify(character.acts.find((a) => a.id === 'peekEdge').eyeLife.gapMs)}ms）`)

    // 收摊：保持态结束 → 眨眼状态一起清掉，换回情绪贴图
    api.stopAct()
    ok(api.motion().eye === null, '动作结束后不再报告眨眼状态')
    ok(api.blink() === false, '没有保持态时 blink() 不会乱眨')
    await dragTo(600)
    await sleep(400)
  }

  // —— 6f) 右键菜单：只剩 说句话 / 设置面板 / 隐藏（「换个表情」已按需求移除，v0.15.2）——
  {
    const stg = root.querySelector('.dgw-stage')
    const bubbleEl = root.querySelector('.dgw-bubble')
    stg.dispatch('contextmenu', { clientX: 40, clientY: 40 })
    ok(!!stub.document.body.querySelector('.dgw-menu'), '右键能打开菜单')
    const labels = stub.document.body.querySelectorAll('.dgw-menu-item').map((d) => String(d.textContent))
    ok(labels.length === 3, `菜单只剩 3 项（${labels.join(' / ')}）`)
    ok(!labels.some((t) => t.includes('换个表情')), '菜单里没有「换个表情」（换表情仍可双击/面板）')
    ok(labels.some((t) => t.includes('说句话')) && labels.some((t) => t.includes('设置面板')) && labels.some((t) => t.includes('隐藏')),
      '说句话 / 设置面板 / 隐藏 都还在（删除没有误伤）')
    // 点「说句话」仍然会开口：气泡重新出现（确认删的是换表情，不是说话）
    bubbleEl.style.display = 'none'
    await sleep(400)   // 等上一句逐字收尾，避免把旧气泡当成新气泡
    stub.document.body.querySelectorAll('.dgw-menu-item')
      .find((d) => String(d.textContent).includes('说句话'))?.dispatch('click')
    await sleep(120)
    ok(bubbleEl.style.display === 'block', '「说句话」仍然会说一句')
    ok(!stub.document.body.querySelector('.dgw-menu'), '点完菜单自动收起')
  }

  // —— 7) 隐藏 / 唤回 / 清理 ——
  api.hide()
  ok(root.style.visibility === 'hidden', 'hide() 用 visibility 隐藏（保留盒尺寸）')
  api.show()
  ok(root.style.visibility === 'visible', 'show() 能唤回')
  api._teardown()
  ok(!stub.root(), '_teardown() 把节点摘干净（重复注入不会留残骸）')

  await sleep(60)
  ok(uncaughtCount === 0, '整个流程没有未捕获异常（有的话处理器已经让进程红了）')
  return passed
}

// 形态 × 语言组合各跑一遍
const CASES = [
  { mode: 'inline' },
  { mode: 'external' },
  { mode: 'external', locale: 'en' },
  { mode: 'external', locale: 'en', dropLocaleKey: 'zone:body' }   // 缺译文 → 回落中文
]
let total = 0
for (const c of CASES) {
  total += await runCase(c)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  console.error(`\n✗ 运行时冒烟测试失败：${failures.length} 项`)
  process.exit(1)
}
console.log(`✓ 运行时冒烟测试通过（inline + external × 中/英 共 ${CASES.length} 组、${total} 项断言：启动 / 待机底图 / 情绪 / 气泡 / 事件桥 / 台词覆写 / 语言包与回落 / 右键菜单 / 生命周期）`)
// 引擎自带 watchdog/sleep/idleSpeak 等定时器，会一直吊着事件循环 —— 断言跑完就主动退出
process.exit(0)
