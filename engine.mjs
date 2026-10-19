// engine.mjs — DeepSeek 鲸鱼娘看板娘 · 前端注入引擎（位图表情集版）
// 产出注入 index.html 的完整 HTML 字符串：<style> + <script>(IIFE)
// 角色 = assets/ 下的透明 PNG 表情集（统一画布对齐）+ idle.webm 待机动画（VP9 alpha）；
// 引擎负责：情绪状态机、DOM 感知 AI 状态、说话口型、气泡台词、拖拽/菜单/设置、
// 视线跟随、鼠标转速→头晕、连点→生气、闲置入睡、主题跟随。全部 CSS 类 dgw- 前缀，脚本 IIFE 不污染全局。
import config from './mascot.config.mjs'
import character from './character.mjs'

// 由 index.js 调用：注入素材服务前缀与版本号（版本号用于破缓存）
const BASE_TOKEN = '__DGW_ASSET_BASE__'
const VER_TOKEN = '__DGW_ASSET_VER__'

const cache = new Map()

// 两种注入形态（见 §20.4「引擎改资产文件」）：
//   inline   —— 把配置/角色/引擎全塞进 index.html（老形态，兼容性最好，但每次加载都要重传 ~97KB）
//   external —— index.html 只留 <style> + 数据 <script> + <script src="/__mascot/engine.js">
//               引擎脚本由 Host 路由提供，可被浏览器缓存（ETag/304），index.html 缩到 ~22KB
const PROLOGUE_TOKEN = '__DGW_PROLOGUE__'

/** 内联形态的开头：直接把配置与角色写成字面量（无需任何请求即可工作）。 */
function prologueInline(cfg, chr) {
  return [
    'var CFG = ' + JSON.stringify(cfg) + ';',
    'var CHAR = ' + JSON.stringify(chr) + ';',
    '  // 素材前缀做成绝对 URL：自定义协议外壳（Electron）下根相对路径会解析错',
    'var BASE = (function(){',
    "    var b='" + BASE_TOKEN + "';",
    '    if(/^[a-z][a-z0-9+.-]*:\\/\\//i.test(b)) return b;',
    "    return (location.protocol||'http:')+'//'+(location.host||'127.0.0.1')+b;",
    '  })();',
    "var VER = '" + VER_TOKEN + "';"
  ].join('\n  ')
}

/** 外链形态的开头：配置与角色由同页的数据 <script> 提供（window.__DGW_DATA__）。 */
function prologueExternal() {
  return [
    'var DATA = window.__DGW_DATA__ || {};',
    'var CFG = DATA.cfg || {};',
    'var CHAR = DATA.char || {};',
    '  // 素材前缀做成绝对 URL：自定义协议外壳（Electron）下根相对路径会解析错',
    'var BASE = (function(){',
    "    var b=DATA.assetBase||'/__mascot/asset/';",
    '    if(/^[a-z][a-z0-9+.-]*:\\/\\//i.test(b)) return b;',
    "    return (location.protocol||'http:')+'//'+(location.host||'127.0.0.1')+b;",
    '  })();',
    "var VER = DATA.ver || '0';"
  ].join('\n  ')
}

/** 把模板里的占位符填成最终文本。 */
function fillTemplate(text, prologue, cfg, chr, assetBase, assetVersion) {
  return text
    .split(PROLOGUE_TOKEN).join(prologue)
    .split('__DGW_CFG__').join(cfg === null || cfg === undefined ? '{}' : JSON.stringify(cfg))
    .split('__DGW_CHAR__').join(chr === null || chr === undefined ? '{}' : JSON.stringify(chr))
    .split(BASE_TOKEN).join(assetBase)
    .split(VER_TOKEN).join(assetVersion)
}

// 模板 = 样式占位 + <script> 内联脚本；这里切一次，两种形态共用同一份引擎代码（单一事实源）。
// 注意：template 在文件下半部分才声明（很长），所以这里做成惰性求值，避免 TDZ。
const OPEN_TAG = '<script>\n'
const CLOSE_TAG = '</script>'
let partsCache = null
function parts() {
  if (partsCache === null) {
    const open = template.indexOf(OPEN_TAG)
    partsCache = {
      stylePrefix: template.slice(0, open),
      scriptInner: template.slice(open + OPEN_TAG.length, template.lastIndexOf(CLOSE_TAG))
    }
  }
  return partsCache
}

/**
 * 纯函数：把"配置 + 角色 + 素材前缀"渲染成注入 index.html 的 HTML 片段（内联形态）。
 * 做成纯函数是为了让 index.js 能在编辑文件后**重新求值**（改 style/引擎/台词不用重启 dsh）。
 * @param {object} cfg mascot.config.mjs 的导出
 * @param {object} chr character.mjs 的导出
 * @param {string} assetBase 素材 URL 前缀
 * @param {string} assetVersion 版本号（cache-busting）
 * @returns {string} `<style>…</style><script>…</script>`
 */
export function buildInject(cfg, chr, assetBase, assetVersion) {
  return parts().stylePrefix.split('__DGW_CSS__').join(cssTemplate(cfg))
    + OPEN_TAG
    + fillTemplate(parts().scriptInner, prologueInline(cfg, chr), cfg, chr, assetBase, assetVersion)
    + CLOSE_TAG
}

/**
 * 引擎脚本本体（外链形态）：不含 <style>，数据从 window.__DGW_DATA__ 取。
 * Host 用它实现 GET /__mascot/engine.js；contentHash 供 ETag 用（内容没变就能 304）。
 */
export function renderClientScript(assetBase, assetVersion) {
  const key = 'client|' + assetBase + '|' + assetVersion
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const src = fillTemplate(parts().scriptInner, prologueExternal(), null, null, assetBase, assetVersion)
  cache.set(key, src)
  return src
}

/** 外链形态的注入片段：样式 + 数据 + <script src>。 */
export function buildCompactInject(cfg, chr, assetBase, assetVersion, enginePath) {
  const data = JSON.stringify({ cfg, char: chr, assetBase, ver: assetVersion })
  // 引擎路由是**站内绝对路径**（/__mascot/engine.js）；只有相对路径才拼到素材目录下。
  // （事件桥 URL 同款坑：把绝对路径拼到 assetBase 后面会变成 /__mascot/asset/__mascot/...）
  const rel = String(enginePath || '/__mascot/engine.js')
  const src = rel.charAt(0) === '/' ? rel : assetBase.replace(/[^/]*$/, '') + rel
  return parts().stylePrefix.split('__DGW_CSS__').join(cssTemplate(cfg))
    + '<script id="dsh-whale-girl-data">window.__DGW_DATA__='
    + data.split('</').join('<\\/')   // 便宜保险：数据里出现 </script> 也不会提前闭合
    + ';</script>\n'
    + '<script src="' + src + '?v=' + encodeURIComponent(assetVersion) + '"></script>\n'
}

/** 用包内默认配置渲染一次（首次注入 / 自检用）。 */
export function renderInject(assetBase, assetVersion) {
  const key = assetBase + '|' + assetVersion
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const html = buildInject(config, character, assetBase, assetVersion)
  cache.set(key, html)
  return html
}

/** 用包内默认配置渲染外链形态（自检 / 冒烟测试用）。 */
export function renderCompact(assetBase, assetVersion, enginePath) {
  return buildCompactInject(config, character, assetBase, assetVersion, enginePath)
}

/** 角色相关样式（由 buildInject 用当前配置渲染）。 */
function cssTemplate(cfg) {
  return `
<style id="dsh-whale-girl-style">
.dgw-root{
  position:fixed; z-index:${cfg.zIndex};
  pointer-events:none; user-select:none; -webkit-user-select:none; line-height:1; font-family:inherit;
}
/* 颜色优先用 dsh 设计令牌（--dsw-*，body 内联样式，深浅色/第三方主题自动跟随），取不到时用兜底值 */
.dgw-root,.dgw-menu,.dgw-panel{
  --dgw-bg:var(--dsw-alias-bg-overlay, rgba(255,255,255,.94));
  --dgw-fg:var(--dsw-alias-label-primary, #152a44);
  --dgw-fg2:var(--dsw-alias-label-secondary, #5a6d84);
  --dgw-border:var(--dsw-alias-border-l1, rgba(214,223,236,.85));
  --dgw-hover:rgba(47,111,237,.13);
}
.dgw-dark{
  --dgw-bg:var(--dsw-alias-bg-overlay, rgba(22,29,45,.93));
  --dgw-fg:var(--dsw-alias-label-primary, #e7eefa);
  --dgw-fg2:var(--dsw-alias-label-secondary, #9db0c8);
  --dgw-border:var(--dsw-alias-border-l1, rgba(60,72,96,.6));
  --dgw-hover:rgba(120,170,255,.16);
}
.dgw-stage{position:relative; width:max-content; pointer-events:none; touch-action:none;
  transform-origin:50% 100%; transition:transform .18s ease-out}
/* 命中层：按角色剪影裁切，透明留白不吃鼠标事件（多边形由 tools/build-assets.ps1 自动生成） */
.dgw-hit{position:absolute; inset:0; pointer-events:auto; cursor:grab;
  clip-path:polygon(${cfg.hitPolygon}); -webkit-clip-path:polygon(${cfg.hitPolygon})}
.dgw-hit:active{cursor:grabbing}
.dgw-hit:focus-visible{outline:2px dashed rgba(90,150,240,.9); outline-offset:-2px}
/* 伪 3D 转头：枢轴放在脖子，转头才像人转头而不是整张图片旋转 */
.dgw-gaze{transform-origin:50% ${(cfg.gaze&&cfg.gaze.pivotY!=null?Math.round(cfg.gaze.pivotY*100):58)}%; will-change:transform}
/* 完全静止（无障碍选项）：关掉全部关键帧动画 */
.dgw-still .dgw-anim{animation:none !important}
.dgw-still .dgw-fx{display:none}
.dgw-attn{will-change:transform}
.dgw-anim{position:relative; transform-origin:50% 100%}

/* —— 角色叠层：立绘定尺寸在下，待机动画视频绝对定位覆盖其上 ——
   只用 opacity 切换，绝不动 display：Chromium 里 display:none 会让视频层脱离合成器，
   再显示时停在旧帧（看起来"变成一张不会动的图"），而且恢复播放也不刷新。 */
.dgw-img,.dgw-video{display:block; width:auto; pointer-events:none; transform-origin:50% 100%;
  transition:opacity ${cfg.idleFadeMs}ms ease;
  filter:drop-shadow(0 6px 12px rgba(47,111,237,.20));}
.dgw-video{position:absolute; left:0; top:0}
.dgw-dark .dgw-img,.dgw-dark .dgw-video{filter:drop-shadow(0 6px 12px rgba(90,150,240,.18))}
.dgw-off{opacity:0 !important}

/* —— 情绪动画（作用在 .dgw-anim，不干扰 JS 的视线偏移与拖拽定位）—— */
@keyframes dgw-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes dgw-lean{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-4px) rotate(-1.2deg)}}
@keyframes dgw-work{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes dgw-think{0%,100%{transform:rotate(-2.6deg) translateY(0)}50%{transform:rotate(2.6deg) translateY(-2px)}}
@keyframes dgw-pop{0%{transform:scale(.92) translateY(6px)}60%{transform:scale(1.06) translateY(-8px)}100%{transform:scale(1) translateY(0)}}
@keyframes dgw-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px) rotate(-1.5deg)}75%{transform:translateX(4px) rotate(1.5deg)}}
@keyframes dgw-anger{0%,100%{transform:translateY(0) rotate(0)}20%{transform:translateY(-3px) rotate(-2.5deg)}60%{transform:translateY(-1px) rotate(2.5deg)}}
@keyframes dgw-dizzy{0%{transform:translateX(0) rotate(0)}25%{transform:translateX(-5px) rotate(-3deg)}75%{transform:translateX(5px) rotate(3deg)}100%{transform:translateX(0) rotate(0)}}
/* 打盹也要"活着"：明显的呼吸缩放 + 明暗起伏（避免看起来像一张静止图） */
@keyframes dgw-sleep{0%,100%{transform:scale(.95) translateY(4px);opacity:.78}50%{transform:scale(.99) translateY(0);opacity:.95}}
@keyframes dgw-breathe{0%,100%{transform:scale(1) translateY(0)}50%{transform:scale(1.006) translateY(-1px)}}
@keyframes dgw-particle{0%{transform:translateY(0) scale(.8);opacity:0}25%{opacity:1}100%{transform:translateY(-42px) scale(1.05);opacity:0}}

/* 动画由 character.mjs 的 anim 字段驱动，在 setMood 里写成内联 style.animation（单一数据源）；
   这里的默认值只负责"JS 还没跑"和"新增情绪忘了配动画"两种情况 —— 无论如何都不会是一张死图。 */
.dgw-anim{animation:dgw-float 3.4s ease-in-out infinite}
/* 减少动态效果：不播视频、不做大幅动画，但保留极轻微呼吸（静态死图不是无障碍要求） */
.dgw-reduced .dgw-anim{animation:dgw-breathe 4.2s ease-in-out infinite !important}

/* —— 粒子特效 —— */
.dgw-fx{position:absolute; top:6%; left:50%; pointer-events:none; font-size:17px; font-weight:700;
  color:#5b8dee; opacity:0; animation:dgw-particle 1.5s ease-in-out infinite; text-shadow:0 1px 2px rgba(255,255,255,.6)}
.dgw-dark .dgw-fx{color:#9dc2ff; text-shadow:0 1px 2px rgba(0,0,0,.5)}
.dgw-fx.dgw-fx-2{left:30%; animation-delay:.3s}
.dgw-fx.dgw-fx-3{left:70%; animation-delay:.6s}
.dgw-fx-lg{font-size:22px}

/* —— 气泡 —— */
.dgw-bubble{position:absolute; bottom:calc(100% + 10px); left:50%; transform:translateX(-50%);
  background:var(--dgw-bg); color:var(--dgw-fg); padding:8px 13px; border-radius:13px; font-size:13px; line-height:1.45;
  border:1px solid var(--dgw-border);
  box-shadow:0 6px 20px rgba(15,35,70,.18); backdrop-filter:blur(8px); max-width:min(280px,60vw); word-break:break-word;
  pointer-events:none; z-index:3; animation:dgw-bubble-in .18s ease-out}
.dgw-bubble::after{content:''; position:absolute; top:100%; left:50%; margin-left:-6px; border:6px solid transparent; border-top-color:var(--dgw-bg)}
@keyframes dgw-bubble-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}

/* —— 右键菜单 —— */
.dgw-menu{position:fixed; z-index:${cfg.zIndex + 1000}; min-width:152px; background:var(--dgw-bg);
  border:1px solid var(--dgw-border); border-radius:11px; padding:5px; box-shadow:0 12px 30px rgba(15,35,70,.22);
  backdrop-filter:blur(12px); animation:dgw-pop2 .14s ease-out}
.dgw-menu-item{padding:7px 11px; font-size:13px; color:var(--dgw-fg); border-radius:7px; cursor:pointer; white-space:nowrap}
.dgw-menu-item:hover{background:var(--dgw-hover)}
.dgw-menu-sep{height:1px; margin:5px 4px; background:var(--dgw-border)}
@keyframes dgw-pop2{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}

/* —— 设置面板 —— */
.dgw-panel{position:fixed; z-index:${cfg.zIndex + 1000}; width:298px; max-height:74vh; overflow:auto;
  right:22px; bottom:22px; background:var(--dgw-bg); color:var(--dgw-fg); border:1px solid var(--dgw-border);
  border-radius:15px; box-shadow:0 16px 40px rgba(15,35,70,.24); backdrop-filter:blur(14px); font-size:13px; animation:dgw-pop2 .16s ease-out}
.dgw-panel-head{padding:11px 14px; font-weight:600; display:flex; justify-content:space-between; align-items:center;
  border-bottom:1px solid var(--dgw-border); cursor:move; user-select:none; touch-action:none}
.dgw-panel-titlebar{display:flex; align-items:center; gap:7px; pointer-events:none}
.dgw-panel-grip{color:var(--dgw-fg2); font-size:12px; letter-spacing:1px}
.dgw-panel-close{border:none; background:transparent; cursor:pointer; font-size:18px; color:inherit; line-height:1}
.dgw-panel-body{padding:12px 14px; display:flex; flex-direction:column; gap:10px}
.dgw-panel-row{display:flex; justify-content:space-between; align-items:center; gap:10px}
.dgw-panel-label{color:var(--dgw-fg2)}
.dgw-panel input[type=range]{flex:1; min-width:110px}
.dgw-panel input[type=checkbox]{width:16px; height:16px}
.dgw-panel-title{font-size:11px; letter-spacing:.06em; color:var(--dgw-fg2); margin-top:2px}
.dgw-mood-btn{border:1px solid var(--dgw-border); background:transparent; color:inherit; font-size:12px;
  padding:4px 8px; border-radius:8px; cursor:pointer; margin:0 4px 4px 0}
.dgw-mood-btn:hover{background:var(--dgw-hover)}
.dgw-ghost{border:1px solid var(--dgw-border); background:transparent; color:inherit; font-size:12px; padding:4px 9px;
  border-radius:8px; cursor:pointer}
.dgw-ghost:hover{background:var(--dgw-hover)}
.dgw-hint{font-size:11px; color:var(--dgw-fg2); line-height:1.5}
.dgw-dialogue summary{cursor:pointer; list-style:none}
.dgw-dialogue summary::marker{content:''}
.dgw-dialogue-body{display:flex; flex-direction:column; gap:8px; padding-top:7px}
.dgw-dlg-select,.dgw-dlg-text{width:100%; box-sizing:border-box; background:transparent; color:inherit; border:1px solid var(--dgw-border); border-radius:8px; padding:5px 7px; font:inherit; font-size:12px}
.dgw-dlg-text{resize:vertical; min-height:92px; line-height:1.5}

/* —— 提示条 —— */
.dgw-tip{position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); font-size:11px; color:#fff;
  background:rgba(20,30,50,.74); padding:3px 8px; border-radius:8px; pointer-events:none; white-space:nowrap; z-index:4}
</style>
`
}

/** 注入片段骨架：样式/配置/角色/素材前缀在 buildInject 里替换（保留 token，方便重新求值）。 */
const template = `
__DGW_CSS__<script>
(function(){
  __DGW_PROLOGUE__
  var STORE_KEY = CFG.storageKey;
  var MOOD_IDS = Object.keys(CHAR.moods);

  var root=null, stage=null, attn=null, gazeEl=null, anim=null, img=null, video=null, hit=null, bubble=null, menu=null, panel=null, tipEl=null;
  var videoOk=false, playFails=0, stillSince=0;
  var mood='idle', transient=null, sleeping=false, lastActivity=Date.now();
  var bubbleTimer=null, bubbleVisible=false, lipTimer=null, lipOpen=false;
  var transientTimer=null, sleepTimer=null, sleepFxTimer=null, idleSpeakTimer=null, greetDone=false;
  var recentPool=[], lastSpeakAt=0, lastVisualKey='', preloaded=[];
  // 事件桥状态：phase 来自宿主事件（精确），sensorMood 来自 DOM 观察（兜底）
  var bridgePhase=null, bridgeTool=null, bridgeDetail='', bridgeAt=0, bridgeSeq=-1, bridgeOk=false, bridgeTurn=0;
  var streaks={}, lastStreakKind=null, lastStreakAt=0;
  var bridgeSrc=null, bridgeRetry=null, bridgeLastSpoken='';
  var drag={on:false, moved:false, sx:0, sy:0, ox:0, oy:0, down:false};
  var attnState={tx:0, ty:0, cx:0, cy:0, raf:false};
  var speed={pts:[], lastSample:0};
  var dizzy={on:false, since:0, until:0, recover:0};
  var clicks=[], sensorMood=null, sensorTimer=null, workSince=0, settleTimer=null, errorKey='';
  var sensorObserver=null, themeObserver=null, sensorFocusIn=null, themeApply=null;
  var videoRetries=0, watchdogTimer=null, liveTimers=[], liveListeners=[];
  var microTimer=null, microRestoreTimer=null, typeTimer=null, lastMicroId='';
  var speedLook=1, hoverScaleCur=1, hoverTarget=1, hoverRaf=false, dragTilt=0, edgeTilt=0;
  // 交互物理 / 音效状态
  var approach={ d:null, armed:true }, startleAt=0;
  var gaze={ yaw:0, pitch:0 };   // 伪 3D 转头角度（单位：度）
  // 休闲动作（动态待机动作）：动作自己改写 actPose，由 applyPoseTransform 统一合成姿态
  var actCurrent=null, actTimer=null, actRaf=null, actStartedAt=0, actUntil=0;
  var edgeWatchTimer=null, edgeSince=null, edgeArmedSide=null, lastEdgeActAt=0;   // 贴边触发
  var actPose={ x:0, y:0, yaw:0, pitch:0, scale:1, reveal:1, side:0 };
  var actFrameFile=null, actFrameIdx=-1;   // 动作帧序列（素材给姿势、引擎给节奏）
  // 保持态里的"眼睛活着"：贴边偷看停在最后一帧后就一直不动，按下面的节奏插一帧闭眼（眨眼）
  var eyeBlinkOn=false, eyeBlinkUntil=0, eyeNextBlinkAt=0;
  var reduced = false, ctxWorkspace=null;

  // ---------- 设置持久化 ----------
  function defaults(){
    return {
      pos:{ left:null, top:null }, scale:CFG.defaultScale, opacity:CFG.defaultOpacity,
      autoSpeak:true, followCursor:CFG.followCursor, dizzy:CFG.dizzy, angry:CFG.angry,
      idleMotion:CFG.idleMotion, locked:false, panelPos:null, bridge:(!CFG.bridge||CFG.bridge.enabled!==false), still:(!!(CFG.a11y&&CFG.a11y.stillMode)), lang:'auto', v:6
    };
  }
  function loadState(){
    var d=defaults();
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(raw){
        var o=JSON.parse(raw);
        if(o&&typeof o==='object'){
          if(typeof o.scale==='number') d.scale=o.scale;
          if(typeof o.opacity==='number') d.opacity=o.opacity;
          if(typeof o.autoSpeak==='boolean') d.autoSpeak=o.autoSpeak;
          if(typeof o.followCursor==='boolean') d.followCursor=o.followCursor;
          if(typeof o.dizzy==='boolean') d.dizzy=o.dizzy;
          if(typeof o.angry==='boolean') d.angry=o.angry;
          if(typeof o.bridge==='boolean') d.bridge=o.bridge;
          if(typeof o.still==='boolean') d.still=o.still;
          if(typeof o.lang==='string') d.lang=o.lang;
          if(o.idleMotion==='video'||o.idleMotion==='static') d.idleMotion=o.idleMotion;
          d.locked=!!o.locked;
          if(o.pos&&typeof o.pos.left==='number') d.pos.left=o.pos.left;
          if(o.pos&&typeof o.pos.top==='number') d.pos.top=o.pos.top;
          // 设置面板的位置也记住（拖过面板的人不希望每次都复位）
          if(o.panelPos&&typeof o.panelPos.left==='number'&&typeof o.panelPos.top==='number') d.panelPos={ left:o.panelPos.left, top:o.panelPos.top };
        }
      }
    }catch(e){}
    if(d.pos.left===null||d.pos.top===null){
      var W=window.innerWidth||document.documentElement.clientWidth||1280;
      var H=window.innerHeight||document.documentElement.clientHeight||800;
      d.pos.left=W-CFG.defaultPos.right-canvasW()*d.scale;
      d.pos.top=H-CFG.defaultPos.bottom-canvasH()*d.scale;
    }
    return d;
  }
  function saveState(){
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify({
        pos:state.pos, scale:state.scale, opacity:state.opacity, autoSpeak:state.autoSpeak,
        followCursor:state.followCursor, dizzy:state.dizzy, angry:state.angry,
        idleMotion:state.idleMotion, locked:state.locked, panelPos:state.panelPos, bridge:state.bridge, still:state.still, lang:state.lang, v:6
      }));
    }catch(e){}
  }
  function canvasW(){ return Math.round(CFG.imgHeight*0.75); }
  function canvasH(){ return Math.round(CFG.imgHeight); }
  var state = loadState();

  // ---------- 小工具 ----------
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function now(){ return Date.now(); }
  function moodObj(id){ return CHAR.moods[id]||CHAR.moods.idle; }
  /** 情绪名（面板标签/提示/插值用）：优先语言包 label:*，否则中文兜底。 */
  function moodLabel(id){ return t('label:'+id, moodObj(id).label); }
  function assetUrl(file){ return BASE+file+'?v='+VER; }
  // ---------- 台词引擎：条件筛选 + 权重 + 语气梯度 ----------
  /** 连续同类事件计数（语气梯度用）：同一类连着来就累加，隔太久或换了类就重新计。 */
  function bumpStreak(kind){
    if(!kind) return;
    var t=now();
    var resetMs=(CFG.dialogue&&CFG.dialogue.streakResetMs)||60000;
    if(lastStreakKind!==kind||t-lastStreakAt>resetMs) streaks[kind]=1;
    else streaks[kind]=(streaks[kind]||0)+1;
    lastStreakKind=kind; lastStreakAt=t;
  }
  function isNight(h){
    var d=CFG.dialogue||{};
    var ns=d.nightStart==null?22:d.nightStart, ne=d.nightEnd==null?5:d.nightEnd;
    return ns<=ne?(h>=ns&&h<ne):(h>=ns||h<ne);
  }
  /** 判断一条台词的条件是否成立（键名在自检里有校验，拼错会当场红）。 */
  function whenOk(when){
    if(!when) return true;
    var h=(new Date()).getHours();
    if(when.night===true&&!isNight(h)) return false;
    if(when.night===false&&isNight(h)) return false;
    if(when.hourMin!=null||when.hourMax!=null){
      var lo=when.hourMin==null?0:when.hourMin, hi=when.hourMax==null?23:when.hourMax;
      var inWin=lo<=hi?(h>=lo&&h<=hi):(h>=lo||h<=hi);
      if(!inWin) return false;
    }
    if(when.weekday&&when.weekday.length){
      var wd=(new Date()).getDay()||7;   // 1=周一 … 7=周日
      if(when.weekday.indexOf(wd)===-1) return false;
    }
    if(when.phase!=null){ if(!bridgeFresh()||bridgePhase!==when.phase) return false; }
    if(when.bridge===true&&!bridgeFresh()) return false;
    if(when.bridge===false&&bridgeFresh()) return false;
    if(when.streak){
      var key=when.streak.key, min=when.streak.min==null?2:when.streak.min;
      if((streaks[key]||0)<min) return false;
    }
    if(when.idleFor!=null&&(now()-lastActivity)<when.idleFor) return false;
    if(when.minTurns!=null&&(bridgeTurn||0)<when.minTurns) return false;
    return true;
  }
  /** 候选台词：命中条件的条目优先；一条都没命中就退回无条件台词（永不失语）。 */
  function candidates(pool){
    var cond=[], plain=[];
    for(var i=0;i<pool.length;i++){
      var e=pool[i];
      if(typeof e==='string'){ if(e) plain.push({ line:e, weight:1 }); continue; }
      if(!e||!e.line) continue;
      var w=(typeof e.weight==='number'&&e.weight>0)?e.weight:1;
      if(whenOk(e.when)) cond.push({ line:e.line, weight:(CFG.dialogue&&CFG.dialogue.weights===false)?1:w });
    }
    return cond.length?cond:plain;
  }
  function pickWeighted(list){
    var total=0, i;
    for(i=0;i<list.length;i++) total+=list[i].weight;
    var r=Math.random()*total;
    for(i=0;i<list.length;i++){ r-=list[i].weight; if(r<=0) return list[i].line; }
    return list[list.length-1].line;
  }
  // ---------- 台词本地覆写（面板里可改，存 localStorage，免重启） ----------
  // 键名空间：mood:<id> / interact:<group> / zone:<zone> / micro:<id> / bridge:<phase> / time:<seg> / random
  var BACKTICK=String.fromCharCode(96), NL=String.fromCharCode(10), CR=String.fromCharCode(13);   // 模板字符串里不能直接写反引号，只能这样拿
  var DIALOGUE_KEY=STORE_KEY+'.dialogue';
  var dialogueOverrides={};
  function sanitizeLines(arr){
    if(!Array.isArray(arr)) return null;
    var out=[];
    for(var i=0;i<arr.length&&out.length<40;i++){
      var s=String(arr[i]==null?'':arr[i]).split(CR).join(' ').split(NL).join(' ').split(BACKTICK).join('').trim();
      if(!s) continue;
      out.push(s.slice(0,80));   // 气泡最多两行；超长很难看，这里直接截断
    }
    return out.length?out:null;
  }
  function loadDialogueOverrides(){
    try{
      var raw=localStorage.getItem(DIALOGUE_KEY);
      if(!raw) return;
      var o=JSON.parse(raw);
      if(!o||typeof o!=='object') return;
      for(var k in o){
        if(!Object.prototype.hasOwnProperty.call(o,k)) continue;
        var lines=sanitizeLines(o[k]);
        if(lines) dialogueOverrides[k]=lines;
      }
    }catch(e){}
  }
  function saveDialogueOverrides(){
    try{ localStorage.setItem(DIALOGUE_KEY, JSON.stringify(dialogueOverrides)); }catch(e){}
  }
  /** 语言包：CHAR.locales = { en: { 'mood:idle': [...], ... } }（键与中文池子一一对应，缺键自动回落） */
  var LOCALES=CHAR.locales||{};
  function detectedLang(){
    var l='';
    try{ l=String(window.__DSH_LOCALE__||(navigator&&navigator.language)||'zh'); }catch(e){ l='zh'; }
    l=l.toLowerCase();
    if(l.indexOf('zh')===0) return 'zh';
    var code=l.split('-')[0];
    return LOCALES[code]?code:'en';
  }
  /** 当前生效语言：state.lang 为 auto 时按环境猜；猜不到或不认识就回落中文。 */
  function effectiveLang(){
    var want=(state.lang==='auto'||!state.lang)?detectedLang():state.lang;
    if(want==='zh') return 'zh';
    return LOCALES[want]?want:'zh';
  }
  function localePack(){ var l=effectiveLang(); return l==='zh'?null:(LOCALES[l]||null); }
  /** 面板文案：优先语言包里的 ui:* 条目（数组取第 0 条），没有就用中文兜底。 */
  function t(key, fallback){
    var ov=dialogueOverrides[key];
    if(ov&&ov.length) return ov[0];
    var pack=localePack();
    var loc=pack?pack[key]:null;
    if(loc&&loc.length) return loc[0];
    return fallback;
  }
  /** 取某个池子当前生效的台词：本地覆写 > 语言包 > 角色自带（中文）。 */
  function poolFor(key, pool){
    var ov=dialogueOverrides[key];
    if(ov&&ov.length) return ov;
    var pack=localePack();
    var loc=pack?pack[key]:null;
    if(loc&&loc.length) return loc;
    return pool;
  }
  /** 单句覆写（待机小动作那种一行台词）。 */
  function lineFor(key, fallback){
    var ov=dialogueOverrides[key];
    if(ov&&ov.length) return pickFrom(ov);
    var pack=localePack();
    var loc=pack?pack[key]:null;
    if(loc&&loc.length) return pickFrom(loc);
    return fallback;
  }
  function pickFrom(pool){
    if(!pool||!pool.length) return '';
    var cand=candidates(pool);
    if(!cand.length) return '';
    var fresh=[];
    for(var i=0;i<cand.length;i++){ if(recentPool.indexOf(cand[i].line)===-1) fresh.push(cand[i]); }
    var text=pickWeighted(fresh.length?fresh:cand);
    recentPool.push(text);
    if(recentPool.length>CFG.recentPoolSize) recentPool.shift();
    return text;
  }
  function interp(text){
    var d=new Date();
    var hour=d.getHours();
    return String(text)
      .replace(/\\{workspace\\}/g, ctxWorkspace||'这个项目')
      .replace(/\\{time\\}/g, ('0'+hour).slice(-2)+':'+('0'+d.getMinutes()).slice(-2))
      .replace(/\\{hour\\}/g, String(hour))
      .replace(/\\{date\\}/g, d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2))
      .replace(/\\{state\\}/g, moodLabel(mood))
      .replace(/\\{tool\\}/g, bridgeTool||'工具')
      .replace(/\\{turn\\}/g, String(bridgeTurn||0))
      .replace(/\\{streak\\}/g, String(streaks[mood]||1));
  }
  function safeQuery(sel){ try{ return !!document.querySelector(sel); }catch(e){ return false; } }

  // ---------- 视觉层：待机动画视频为底 + PNG 表情/口型帧叠加 ----------
  // 设计原则（这一版的核心修复）：
  //  1) 中性嘴型的情绪（idle/listening/working）一律用"会动的"底图 —— 视频可用时是视频，
  //     视频不可用时是 idle.png + CSS 浮动动画，绝不出现"换成静帧后一动不动"。
  //  2) 视频与立绘只切 opacity、绝不切 display：display:none 会让视频层脱离合成器并停在旧帧。
  //  3) 有一只看门狗：只要"应该动"却在暂停，就重新 play()；连续失败才降级为静态立绘。
  // 完全静止也要算进来：否则勾了『完全静止』待机动画还在动，名不副实
  function videoUsable(){ return state.idleMotion==='video' && videoOk && !reduced && !state.still; }
  function desiredVisual(){
    // 动作帧序列运行期间，画面由动作帧接管（同步/刷新都不能把它刷回情绪贴图）
    if(actCurrent&&actCurrent.frames&&actFrameFile){
      // 保持态眨眼：只在这一帧（= 眼睛的真实位置）上换闭眼帧，别的帧换了会错位
      var el=actCurrent.eyeLife;
      if(el&&el.blink&&eyeBlinkOn&&actFrameFile===el.base) return { kind:'img', file: el.blink };
      return { kind:'img', file: actFrameFile };
    }
    var m=moodObj(mood);
    if(bubbleVisible && m.lipsync){
      return { kind:'img', file: lipOpen ? CHAR.talking.open : CHAR.talking.closed };
    }
    // 只有显式标了 video:true 的情绪才用待机动画（neutral 嘴型的那几个）；
    // 其余情绪有自己的静帧语义（思考/开心/难过/生气/打盹/头晕）
    if(videoUsable() && m.video===true) return { kind:'video', file:'' };
    return { kind:'img', file:m.asset };
  }
  function syncVisual(force){
    if(img===null) return;
    var d=desiredVisual();
    var key=d.kind+':'+d.file;
    if(key===lastVisualKey && !force) return;
    if(d.kind==='video'){
      // 立绘先留着当"垫底"：只有视频真的在播了才淡出它。
      // 这样即使自动播放被挡，看到的也是会浮动的立绘，而不是一帧卡住的视频画面。
      video.classList.remove('dgw-off');
      if(!video.paused) img.classList.add('dgw-off');
      ensurePlaying();
    } else {
      video.classList.add('dgw-off');
      img.classList.remove('dgw-off');
      var url=assetUrl(d.file);
      if(img.getAttribute('src')!==url) img.src=url;   // 口型帧来回切换时避免重复加载导致闪烁
      maybeIdlePauseVideo();
    }
    lastVisualKey=key;   // 应用成功后再记 key，避免"记了却没生效"
  }
  /** 播放待机动画；失败累计到阈值就降级为静态立绘（并在控制台留一条线索）。 */
  function ensurePlaying(){
    if(!video||!videoUsable()||document.hidden) return;
    if(!video.paused){ playFails=0; return; }
    var p=null;
    try{ p=video.play(); }catch(e){ p=null; }
    if(p&&typeof p.then==='function'){
      p.then(function(){ playFails=0; }).catch(function(err){
        playFails++;
        if(CFG.debug) console.warn('[鲸鱼娘] 待机动画播放失败('+playFails+')', err&&err.name);
        if(playFails>=3){ videoOk=false; syncVisual(true); }
      });
    }
  }
  /** 长时间停在静态表情时把视频暂停省电；回到会动的情绪立刻恢复。 */
  function maybeIdlePauseVideo(){
    if(!video||!videoUsable()) return;
    if(stillSince===0) stillSince=now();
    if(now()-stillSince>CFG.videoIdlePauseMs&&!video.paused){ try{ video.pause(); }catch(e){} }
  }
  function bootVideo(){
    if(!video||state.idleMotion!=='video') return;
    videoOk=false;
    video.addEventListener('loadeddata',function(){ videoOk=true; playFails=0; syncVisual(true); });
    video.addEventListener('playing',function(){
      videoOk=true; playFails=0; videoRetries=0;
      if(desiredVisual().kind==='video') img.classList.add('dgw-off');
    });
    // 暂停时不要把画面留给视频（那是一帧静止图），露出垫底立绘
    video.addEventListener('pause',function(){
      if(desiredVisual().kind==='video') img.classList.remove('dgw-off');
    });
    video.addEventListener('error',function(){
      videoOk=false;
      if(CFG.debug) console.warn('[鲸鱼娘] 待机动画加载失败，先用静态立绘；稍后自动重试');
      syncVisual(true);
      // 一次失败就永久放弃是不行的（后台标签页加载被推迟、dsh 重启时请求被打断……），有限重试
      if(videoRetries<CFG.videoRetries){
        videoRetries++;
        setTimeout(bootVideo, 1500*videoRetries);
      }
    });
    video.addEventListener('stalled',function(){ ensurePlaying(); });
    video.src=assetUrl(CFG.idleVideo)+(videoRetries?('&r='+videoRetries):'');
    try{ video.load(); }catch(e){}
  }
  function preload(){
    var list=[];
    for(var i=0;i<MOOD_IDS.length;i++){ var a=CHAR.moods[MOOD_IDS[i]].asset; if(list.indexOf(a)===-1) list.push(a); }
    list.push(CHAR.talking.closed, CHAR.talking.open);
    // 保留引用，避免 Image 被 GC 掉导致预加载中断
    for(var k=0;k<list.length;k++){ var im=new Image(); im.src=assetUrl(list[k]); preloaded.push(im); }
  }

  // ---------- 动画（单一数据源：character.mjs 的 anim 字段）----------
  // 每个情绪都必须"看起来活着"：一次性动画（完成/出错）后面接一段极轻的呼吸，
  // 否则播完那 0.5~0.8s 就是一张死图（这正是用户看到的"说完话就不动了"）。
  var ANIM={
    float:'dgw-float 3.4s ease-in-out infinite',
    lean:'dgw-lean 2.6s ease-in-out infinite',
    work:'dgw-work .8s ease-in-out infinite',
    think:'dgw-think 1.8s ease-in-out infinite',
    pop:'dgw-pop .5s ease, dgw-breathe 2.2s ease-in-out .5s infinite',
    shake:'dgw-shake .7s ease, dgw-breathe 2.4s ease-in-out .7s infinite',
    anger:'dgw-anger .45s ease-in-out infinite',
    dizzy:'dgw-dizzy .38s linear infinite',
    sleep:'dgw-sleep 2.8s ease-in-out infinite',
    reduced:'dgw-breathe 4.2s ease-in-out infinite'
  };
  function applyAnimation(m, restart){
    if(!anim) return;
    // 未知 anim 名（新增情绪忘了配）也要有动画 → 退回 float，绝不静帧
    var spec=reduced?ANIM.reduced:(ANIM[(m&&m.anim)||'float']||ANIM.float);
    if(restart){ anim.style.animation='none'; void anim.offsetWidth; }  // 强制重播（一次性动画复发）
    anim.style.animation=spec;
  }

  // ---------- 事件桥：宿主相位优先，DOM 传感兜底 ----------
  /** 桥的帧是否还新鲜（超时视为断流，自动退回 DOM 传感）。 */
  function bridgeFresh(){ return !!(CFG.bridge&&CFG.bridge.enabled)&&bridgePhase!==null&&(now()-bridgeAt)<(CFG.bridge.staleMs||8000); }
  /** 当前"AI 在干什么"：桥新鲜就用桥的相位，否则用 DOM 观察结果。 */
  function effectiveSensor(){
    if(!bridgeFresh()) return sensorMood;
    var p=(CHAR.bridge&&CHAR.bridge.phases)?CHAR.bridge.phases[bridgePhase]:null;
    if(!p||!p.mood) return null;      // idle（或未知相位）→ 交给待机/打盹
    if(p.transient) return null;      // done/failed 走瞬态闪一下，不常驻
    return p.mood;
  }
  /** 进入某个相位时说一句该相位的台词（同一相位不重复报）。 */
  function speakPhase(phase){
    if(!CFG.bridge||CFG.bridge.speakPhases===false) return;
    if(phase===bridgeLastSpoken) return;
    var lines=(CHAR.bridge&&CHAR.bridge.lines)?CHAR.bridge.lines[phase]:null;
    if(!lines||!lines.length) return;
    var p=(CHAR.bridge.phases||{})[phase];
    if(p&&p.transient){
      // done/failed 由 phase 处理逻辑负责说，这里不抢
      return;
    }
    var phaseCd=(CFG.bridge&&CFG.bridge.speakCooldownMs)||CFG.speakCoolDownMs||6000;
    if(now()-lastSpeakAt<phaseCd) return;
    bridgeLastSpoken=phase;
    speak(pickFrom(poolFor('bridge:'+phase, lines)));
  }
  /** 收到一帧桥数据：更新相位、必要时闪一个瞬态表情并说话。 */
  function applyBridgeFrame(data){
    if(!data||typeof data!=='object') return;
    if(typeof data.seq==='number'&&data.seq===bridgeSeq) return;
    var prev=bridgePhase;
    bridgeSeq=(typeof data.seq==='number')?data.seq:bridgeSeq+1;
    bridgePhase=typeof data.phase==='string'?data.phase:'idle';
    bridgeTool=data.tool||null;
    if(typeof data.turn==='number') bridgeTurn=data.turn;
    bridgeDetail=data.detail||'';
    bridgeAt=now();
    bridgeOk=true;
    if(bridgePhase!==prev){
      var p=(CHAR.bridge&&CHAR.bridge.phases)?CHAR.bridge.phases[bridgePhase]:null;
      if(p&&p.transient){
        // 完成/出错：闪一次对应的情绪表情 + 说该相位台词（引擎自己的瞬态定时器保证会回来）
        transient=null;
        flash(p.mood, CFG[p.transient]||2000, true);
        var lines=(CHAR.bridge.lines||{})[bridgePhase];
        if(lines&&lines.length&&state.autoSpeak) speak(pickFrom(poolFor('bridge:'+bridgePhase, lines)),{ force:true });
      } else {
        speakPhase(bridgePhase);
        refresh();
      }
    }
    syncVisual();
  }
  function closeBridge(){
    if(bridgeRetry){ clearTimeout(bridgeRetry); bridgeRetry=null; }
    if(bridgeSrc){ try{ bridgeSrc.close(); }catch(e){} bridgeSrc=null; }
    bridgeOk=false;
    bridgePhase=null;   // 关掉后立刻退回 DOM 传感
  }
  function bootBridge(){
    closeBridge();
    if(!CFG.bridge||CFG.bridge.enabled===false||state.bridge===false) return;
    if(typeof window.EventSource!=='function') return;    // 老浏览器/外壳：安静退回 DOM 传感
    // 事件桥路径是**站内绝对路径**（/__mascot/events），要挂在 origin 上，不是挂在素材目录下。
    // 用字符串拼接而不是正则：模板字符串会把正则里的 \/ 吃掉（踩过一次）。
    var origin=(location.protocol||'http:')+'//'+(location.host||'127.0.0.1');
    var rel=String((CFG.bridge&&CFG.bridge.path)||'/__mascot/events');
    var url=origin+(rel.charAt(0)==='/'?rel:('/'+rel));
    try{
      bridgeSrc=new EventSource(url);
    }catch(e){ bridgeSrc=null; return; }
    bridgeSrc.onmessage=function(ev){
      try{ applyBridgeFrame(JSON.parse(ev.data)); }catch(e){}
    };
    bridgeSrc.onopen=function(){ bridgeOk=true; };
    bridgeSrc.onerror=function(){
      bridgeOk=false;
      // EventSource 自己会重连，但显式兜一层：断流期间由 bridgeFresh() 超时退回 DOM 传感
      if(bridgeRetry) return;
      bridgeRetry=setTimeout(function(){
        bridgeRetry=null;
        if(root&&(!CFG.bridge||CFG.bridge.enabled!==false)) bootBridge();
      }, CFG.bridge.retryMs||4000);
    };
  }


  // ---------- 状态机 ----------
  // 优先级：AI 型瞬态（完成/出错）> 感知态 > 用户型瞬态（头晕/生气）> 打盹 > 待机。
  // 用户型瞬态在 AI 干活时直接不插队（"工作中还头晕"是 bug 不是彩蛋）。
  function resolveMood(){
    if(transient){
      if(now()<transient.until){
        if(transient.ai||!effectiveSensor()) return transient.mood;
      } else {
        transient=null;
      }
    }
    var sense=effectiveSensor();
    if(sense) return sense;
    if(sleeping) return 'sleep';
    return 'idle';
  }
  function refresh(opts){
    var m=resolveMood();
    if(m!==mood||(opts&&opts.force)) setMood(m, opts);
    else syncVisual();
  }
  function setMood(id, opts){
    // 保持态（贴边偷看）不被 AI 状态打断：她贴在墙边偷看，AI 在干活也照样看
    if(actCurrent&&id!=='idle'&&!actCurrent.sustain) stopAct(true);
    opts=opts||{};
    if(!CHAR.moods[id]) id='idle';
    if(id===mood&&!opts.force){ syncVisual(); applyAnimation(moodObj(id), false); return; }
    mood=id;
    if(root) root.className='dgw-root dgw-mood-'+id+(root.classList.contains('dgw-dark')?' dgw-dark':'')+(reduced?' dgw-reduced':'')+(state.still?' dgw-still':'');
    if(id!=='idle') bumpStreak(id);   // 语气梯度：连续同类事件计数
    var m=moodObj(id);
    applyAnimation(m, true);   // 进入情绪就重播一次动画：同一情绪重复触发也要有反应
    syncVisual(true);
    buildTip(moodLabel(mood));
    if(m.fx&&!opts.silent) fx(m.fx);
    // 打盹时 Zzz 要"一直冒"，否则就是一张静止图
    if(sleepFxTimer){ clearInterval(sleepFxTimer); sleepFxTimer=null; }
    if(id==='sleep') sleepFxTimer=setInterval(function(){
      if(mood!=='sleep'){ clearInterval(sleepFxTimer); sleepFxTimer=null; return; }
      fx('zzz');
    }, 1900);
    if(!opts.silent && state.autoSpeak && m.pool && m.pool.length && now()-lastSpeakAt>=CFG.speakCoolDownMs){
      speak(pickFrom(poolFor('mood:'+id, m.pool)));
    }
  }
  /**
   * 进入"瞬态表情"并保证一定会自己走开。
   * @param {string} id 情绪
   * @param {number} holdMs 停留时长
   * @param {boolean} ai AI 触发（能盖住感知态）；false = 用户触发（AI 干活时让位）
   * @param {{silent?:boolean}} [opts] 透传给 setMood（silent 表示"别自动说话"，由调用方自己安排台词）
   * 关键：无论中途发生什么（感知态插进来、气泡、拖动……），到点必有一次 refresh()，
   *       避免"表情卡在完成/生气上再也不动了"。
   */
  function flash(id, holdMs, ai, opts){
    if(!ai && sensorMood) return;
    transient={ mood:id, until: now()+holdMs, ai:!!ai };
    setMood(id, opts);
    if(transientTimer) clearTimeout(transientTimer);
    transientTimer=setTimeout(function(){
      transientTimer=null;
      if(transient&&now()>=transient.until) transient=null;
      refresh();
    }, holdMs+30);
  }
  /**
   * "操作型"瞬态（戳它/甩鼠标/连点）：默认即使 AI 在干活也立刻给反馈（behavior.userTransientDuringWork），
   * 且一律到点自动回到当前真实状态。
   */
  function userTransient(id, ms){
    if(!CHAR.moods[id]) return;
    var fallback=(CFG.behavior.transientMs&&CFG.behavior.transientMs.poke)||900;
    flash(id, ms||fallback, !!CFG.behavior.userTransientDuringWork);
  }

  // ---------- 气泡与口型 ----------
  function speak(text, opts){
    opts=opts||{};
    if(!text) return;
    lastSpeakAt=now();
    if(!state.autoSpeak && !opts.force) return;
    if(!bubble){
      bubble=document.createElement('div');
      bubble.className='dgw-bubble';
      if(state.autoSpeak){ bubble.setAttribute('role','status'); bubble.setAttribute('aria-live','polite'); }
      stage.appendChild(bubble);
    }
    var full=interp(text);
    bubble.style.display='block';
    bubbleVisible=true;
    startLip();
    // 逐字显示：气泡与口型一起"说"，比整句砸出来更像对话；长句自动延长停留
    var cps=CFG.behavior.typewriterCps||0;
    if(typeTimer){ clearInterval(typeTimer); typeTimer=null; }
    if(cps>0){
      var shown=0; bubble.textContent='';
      typeTimer=setInterval(function(){
        shown++;
        if(!bubble){ clearInterval(typeTimer); typeTimer=null; return; }
        bubble.textContent=full.slice(0,shown);
        if(shown>=full.length){ clearInterval(typeTimer); typeTimer=null; }
      }, Math.max(16, Math.round(1000/cps)));
    } else {
      bubble.textContent=full;
    }
    var typingMs=cps>0?Math.round(full.length*1000/cps):0;
    var total=Math.max(opts.durationMs||CFG.bubbleDurationMs, typingMs+1300);
    if(bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer=setTimeout(function(){
      bubble.style.display='none';
      bubbleVisible=false;
      if(typeTimer){ clearInterval(typeTimer); typeTimer=null; }
      stopLip();
    }, total);
  }
  function startLip(){
    if(lipTimer) return;
    var m=moodObj(mood);
    if(!m.lipsync) return;
    stillSince=0;
    syncVisual(true);
    // 口型用"可抖动"的自续定时器：固定帧率看起来太快太机械，人说话本来就是不匀的
    var tick=function(){
      if(!bubbleVisible||!moodObj(mood).lipsync){ stopLip(); return; }
      lipOpen=!lipOpen;
      syncVisual(true);
      var base=1000/Math.max(1,CFG.talkFps);
      lipTimer=setTimeout(tick, Math.round(base*(0.7+Math.random()*0.7)));
    };
    var base0=1000/Math.max(1,CFG.talkFps);
    lipTimer=setTimeout(tick, Math.round(base0*(0.7+Math.random()*0.7)));
  }
  function stopLip(){
    if(lipTimer){ clearTimeout(lipTimer); lipTimer=null; }
    lipOpen=false;
    syncVisual(true);
  }

  // ---------- 粒子 ----------
  function fx(kind){
    if(!stage) return;
    var conf={
      star:{txt:'\\u2726',n:3,lg:true},
      zzz:{txt:'Z',n:3},
      spin:{txt:'\\u2606',n:3},
      anger:{txt:'\\u{1F4A2}',n:2},
      note:{txt:'\\u266A',n:2},
      heart:{txt:'\\u2665',n:2},
      question:{txt:'\\uFF1F',n:1,lg:true},
      dot:{txt:'\\u2026',n:2}
    }[kind];
    if(!conf) return;
    for(var i=0;i<conf.n;i++){
      (function(k){
        var s=document.createElement('span');
        s.className='dgw-fx'+(k===1?' dgw-fx-2':(k===2?' dgw-fx-3':''))+(conf.lg?' dgw-fx-lg':'');
        s.textContent=conf.txt;
        s.style.top=(4+k*8)+'%';
        stage.appendChild(s);
        setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s); }, 1800);
      })(i);
    }
  }
  function buildTip(text){
    if(tipEl&&tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl=null;
    if(!text||!stage||!CFG.debug) return;
    tipEl=document.createElement('div');
    tipEl.className='dgw-tip';
    tipEl.textContent=text;
    stage.appendChild(tipEl);
  }

  // ---------- 待机小动作：让"待机"保持生动，而不是一模一样地循环 ----------
  function pickMicro(){
    var list=CHAR.micro||[];
    if(!list.length) return null;
    var pool=list.filter(function(m){ return m.id!==lastMicroId; });
    if(!pool.length) pool=list;
    // 快到入睡时间就优先"打哈欠"，让入睡有铺垫
    if(now()-lastActivity>=CFG.idleToSleepAfterMs*(CFG.behavior.idleMicroBeforeSleepRatio||0.85)){
      var sleepies=list.filter(function(m){ return m.sleepy; });
      if(sleepies.length) pool=sleepies;
    }
    return pool[Math.floor(Math.random()*pool.length)];
  }
  /** 当前是否"真闲"（休闲动作与微动作共用同一判断）。 */
  function isTrulyIdle(){
    return !document.hidden && !isHidden() && !bubbleVisible && !transient && resolveMood()==='idle';
  }
  /** 动作姿态曲线：t 是 0..1 的进度。每个动作只改 actPose，由 applyPoseTransform 合成。 */
  function actPoseAt(act, t, e){
    var k=act.kind, p=act.pose||{};
    if(k==='jog'){
      // 原地跑步：上下弹跳 + 左右交替微倾（频率可调）
      var f=p.hz||2.6;
      actPose.y=-Math.abs(Math.sin(Math.PI*f*t*2))*(p.amp||6);
      actPose.yaw=Math.sin(Math.PI*f*t*2*2)*(p.tiltDeg||3);
      actPose.pitch=(p.pitchDeg||2);
    } else if(k==='peek'){
      // 扒墙偷看：先把身体移到视口外一部分（浏览器自然把越界部分裁掉），再"探出来"，
      // 最后小幅回缩（对应素材第 3 帧"被发现"）。素材只给姿势，位移/倾斜由这里给。
      var dir=e.side==='left'?1:-1;                    // 1 = 贴左边 → 朝右（屏幕内）探出
      // 注意：clampPos 本来就允许角色悬挂到视口外（左 -35%、右 -65%），
      // 所以这里**不能再往外推**（那会看不到人，就是之前"方向反了"的原因），
      // 只做"朝屏幕内探出 → 末端小幅回缩"。
      // 藏身量：把大部分身体推到视口边界之外（浏览器自然裁掉），看起来就是"躲在墙后"；
      // 再叠加一个慢速往复的"探头"，就是"摸墙偷看"。dir=+1 左边缘（朝右探）。
      var hide=(p.hideFrac==null?0.45:p.hideFrac)*canvasW()*state.scale;
      var probe=(p.probePx==null?16:p.probePx)*(0.5+0.5*Math.sin(Math.PI*2*(p.hz==null?0.35:p.hz)*t));
      actPose.x=dir*(-hide+probe);
      actPose.yaw=dir*(p.tiltDeg||4);   // 保持态：倾斜恒定（原来的 ease 变量已随藏身改动移除）
      // 保持态的"待机式微摆"：用挂钟时间而不是 t（保持态里 t 会被钳成 1，摆动会僵住），
      // 让头带着眼睛一直轻轻左右晃 —— 静帧素材也能看出"活着"。
      if(p.swayDeg){
        var ph=now()/1000*Math.PI*2*(p.swayHz==null?0.075:p.swayHz);
        actPose.yaw+=Math.sin(ph)*(p.swayDeg||0);
        actPose.pitch=Math.sin(ph*0.73+1.1)*(p.swayDeg||0)*0.45;
      }
      actPose.y=-2;
      actPose.side=dir;
    } else if(k==='lie'){
      // 趴着看：整体下沉（下半身出视口）+ 缓慢摇摆 + 视线朝上
      actPose.y=(p.sinkPx||10)+Math.sin(Math.PI*2*(p.hz||0.45)*t)*(p.amp||2);
      actPose.pitch=-(p.pitchDeg||5);
      actPose.yaw=Math.sin(Math.PI*2*(p.hz||0.45)*t*0.5)*(p.tiltDeg||2);
    } else if(k==='fan'){
      // 掏折扇扇风：扇子素材到位后才启用（现在只会做轻微的身体摆动）
      var sw=Math.sin(Math.PI*2*(p.hz||1.4)*t);
      actPose.yaw=sw*(p.tiltDeg||4);
      actPose.x=sw*(p.armPx||3);
    }
    actPose.scale=p.scale||1;
  }
  /** 开始一个休闲动作。会被用户操作 / AI 状态 / 隐藏 / 无障碍设置打断。 */
  function startAct(act){
    if(!act||!stage) return false;
    if(state.still||reduced) return false;                 // 完全静止 / 减少动态：不做
    var g=CFG.idleActs||{};
    if(g.enabled===false) return false;
    var list=CHAR.acts||[];
    if(typeof act==='string') act=list.filter(function(x){ return x.id===act; })[0];
    if(!act) return false;
    if(act.needsArt&&!act.artReady) return false;           // 等素材（例如折扇）
    stopAct(true);
    var dur=act.ms||3000;
    actCurrent=act; actStartedAt=now(); actUntil=actStartedAt+dur;
    actFrameIdx=-1; actFrameFile=null;
    if(act.fx) fx(act.fx);
    if(act.line&&state.autoSpeak) speak(lineFor('act:'+act.id, act.line),{ durationMs:dur+600 });
    var step=function(){
      if(!actCurrent||actCurrent.id!==act.id){ actRaf=null; return; }
      var t=(now()-actStartedAt)/dur;
      if(act.sustain==='edge'){
        // 状态保持：只要还贴在边缘（左/右）就一直演；移走就结束
        if(!edgeState().side){ stopAct(); return; }
        if(t>1) t=1;                      // 超出时长后停在末态（探头继续往复）
        actUntil=now()+500;               // 诊断里显示"仍在进行"
      } else if(t>=1){ stopAct(); return; }
      // 帧序列：每 frameMs 换一帧，播完停在最后一帧（靠 act.ms 决定停留多久）
      if(act.frames&&act.frames.length){
        var fi=Math.min(act.frames.length-1, Math.floor((now()-actStartedAt)/(act.frameMs||600)));
        if(fi!==actFrameIdx){
          actFrameIdx=fi; actFrameFile=act.frames[fi];
          syncVisual(true);
        }
      }
      actPoseAt(act, Math.min(1,t), edgeState());
      updateEyeLife(act);          // 保持态里的眨眼（静帧素材也有"眼睛在动"）
      applyGazeTransform();
      // 贴边"扒墙"时把角色往屏幕内收一点，视觉上像"只露一半身子"
      if(act.kind==='peek'&&root&&actPose.reveal<1){ /* 位置不动，只靠姿态表达 */ }
      actRaf=requestAnimationFrame(step);
    };
    actRaf=requestAnimationFrame(step);
    return true;
  }
  /**
   * 保持态"眼睛活着"：贴边偷看的帧序列播完会停在最后一帧上一直不动（那张图是静帧，
   * 而待机态用的是 idle.webm 视频，眼珠逐帧在动）——所以这里按随机间隔把画面切成闭眼帧
   * 约 eyeLife.blinkMs 毫秒，就是一次眨眼；同时把下一帧的闭眼都排好队。
   * 只在"停在最后一帧"（也就是保持态）时眨：别的帧上的眼睛位置不一样，换了会错位。
   */
  function updateEyeLife(act){
    var el=act&&act.eyeLife;
    if(!el||!el.blink||!act.frames||!act.frames.length){
      if(eyeBlinkOn){ eyeBlinkOn=false; eyeNextBlinkAt=0; syncVisual(true); }
      return;
    }
    var resting=actFrameIdx===(act.frames.length-1);
    if(!resting){
      if(eyeBlinkOn){ eyeBlinkOn=false; syncVisual(true); }
      eyeNextBlinkAt=0;                       // 还在播前几帧：等停稳了再重新排
      return;
    }
    var t=now();
    if(eyeBlinkOn){
      if(t>=eyeBlinkUntil){ eyeBlinkOn=false; eyeNextBlinkAt=0; syncVisual(true); }
      return;
    }
    if(eyeNextBlinkAt===0){ eyeNextBlinkAt=t+blinkGap(el); return; }
    if(t>=eyeNextBlinkAt){
      eyeBlinkOn=true; eyeBlinkUntil=t+(el.blinkMs||130);
      syncVisual(true);                       // 换成闭眼帧
    }
  }
  /** 下一次眨眼的间隔（带随机，别像节拍器）。 */
  function blinkGap(el){
    var g=el.gapMs||[2400,6400];
    var lo=g[0]||2400, hi=Math.max(lo, g[1]||6400);
    return lo+Math.random()*(hi-lo);
  }
  /** 立刻眨一次（调试钩子用；返回是否真的眨了）。 */
  function blinkNow(){
    if(!actCurrent||!actCurrent.eyeLife||!actCurrent.eyeLife.blink) return false;
    if(!actCurrent.frames||actFrameIdx!==(actCurrent.frames.length-1)) return false;
    eyeBlinkOn=true; eyeBlinkUntil=now()+(actCurrent.eyeLife.blinkMs||130); eyeNextBlinkAt=0;
    syncVisual(true);
    return true;
  }
  /** 结束（或中止）当前休闲动作：姿态缓出归零。 */
  function stopAct(immediate){
    if(actRaf){ cancelAnimationFrame(actRaf); actRaf=null; }
    actCurrent=null;
    eyeBlinkOn=false; eyeBlinkUntil=0; eyeNextBlinkAt=0;
    if(actFrameFile){ actFrameFile=null; actFrameIdx=-1; syncVisual(true); }   // 交给情绪贴图接管
    if(immediate){ resetActPose(); applyGazeTransform(); }
    else {
      // 缓出：200ms 内把姿态收回，避免"啪"地复位
      var t0=now();
      var ease=function(){
        var k=Math.min(1,(now()-t0)/200);
        actPose.x*=1-k; actPose.y*=1-k; actPose.yaw*=1-k; actPose.pitch*=1-k;
        actPose.scale=1+(actPose.scale-1)*(1-k);
        if(k>=1){ resetActPose(); applyGazeTransform(); return; }
        applyGazeTransform();
        requestAnimationFrame(ease);
      };
      requestAnimationFrame(ease);
    }
  }
  /** 挑一个当前可用的休闲动作（位置条件优先：贴边→扒墙，贴底→趴着看）。 */
  function pickAct(){
    var list=(CHAR.acts||[]).filter(function(a){ return !(a.needsArt&&!a.artReady); });
    if(!list.length) return null;
    var st=edgeState();
    var ok=list.filter(function(a){
      var w=a.when||{};
      if(w.side&&st.side!==w.side) return false;
      if(w.anySide&&!st.side) return false;
      if(w.bottom&&!st.bottom) return false;
      if(w.notBottom&&st.bottom) return false;
      if(w.notEdge&&st.side) return false;
      return true;
    });
    if(!ok.length) return null;
    var total=0, i;
    for(i=0;i<ok.length;i++) total+=(ok[i].weight||1);
    var r=Math.random()*total;
    for(i=0;i<ok.length;i++){ r-=(ok[i].weight||1); if(r<=0) return ok[i]; }
    return ok[ok.length-1];
  }
  /** 闲时行为调度：微动作与休闲动作共用一个"真闲"判断。 */
  function scheduleAct(){
    if(actTimer){ clearTimeout(actTimer); actTimer=null; }
    var g=CFG.idleActs||{};
    if(g.enabled===false) return;
    var min=g.minGapMs||45000, max=Math.max(min, g.maxGapMs||120000);
    actTimer=setTimeout(function(){
      actTimer=null;
      // 贴住左右边缘时，只演扒墙偷看，不触发原地跑步/趴着看等其他动作
      if(isTrulyIdle() && !edgeState().side){
        var act=pickAct();
        if(act) startAct(act);
      }
      scheduleAct();
    }, min+Math.random()*(max-min));
  }
  /**
   * 贴边检测：把角色拖到屏幕左/右边缘并停留 edgeDwellMs，就自动演"扒墙偷看"。
   * 与随机调度互补：随机调度负责"闲着没事做点什么"，这里负责"你把它贴到墙边"。
   */
  /** 贴边动作的门禁：不看 AI 是否在干活（edgeIgnoreAiState），只排除看不见/静止/拖拽中/已有动作。 */
  function canEdgeAct(){
    var g=CFG.idleActs||{};
    if(g.enabled===false||g.edgeTrigger===false) return false;
    if(document.hidden||isHidden()||state.still||reduced||drag.on) return false;
    if(actCurrent) return false;
    if(g.edgeIgnoreAiState===false && resolveMood()!=='idle') return false;   // 想恢复旧行为就把它设成 false
    return true;
  }
  function edgePoll(){
    edgeWatchTimer=null;
    var g=CFG.idleActs||{};
    var off=(g.enabled===false)||(g.edgeTrigger===false)||state.still||reduced||isHidden()||drag.on||document.hidden;
    if(off){ edgeSince=null; }
    else {
      var st=edgeState();
      if(!st.side){ edgeSince=null; edgeArmedSide=null; }           // 离开边缘 → 解除武装
      else {
        if(edgeArmedSide!==st.side){
          // 换到另一侧 = 新一次到访：重新计时，并且把长冷却缩短（否则"拖到另一边"像是不生效）
          edgeArmedSide=st.side; edgeSince=now();
          // 换边 = 新一次到访：直接清掉长冷却（停留 edgeDwellMs 本身就是防抖），
          // 否则刚从左边演完再拖到右边，会因为 24s 冷却而'不生效'。
          lastEdgeActAt=0;
        }
        var dwell=(g.edgeDwellMs==null?2000:g.edgeDwellMs);
        var cd=(g.edgeCooldownMs==null?24000:g.edgeCooldownMs);
        if(now()-edgeSince>=dwell && canEdgeAct() && now()-lastEdgeActAt>=cd){
          lastEdgeActAt=now(); edgeSince=null;
          startAct('peekEdge');
        }
      }
    }
    startEdgeWatch();
  }
  function startEdgeWatch(){
    if(edgeWatchTimer) return;
    var g=CFG.idleActs||{};
    if(g.enabled===false||g.edgeTrigger===false) return;
    edgeWatchTimer=setTimeout(edgePoll, (g.edgePollMs==null?500:g.edgePollMs));
  }
  function microAction(e){
    if(!e||!stage) return;
    lastMicroId=e.id;
    if(e.mood){
      flash(e.mood, e.ms, false);             // 换脸的小动作：限时瞬态 + 让位于 AI 状态，到点自己回待机
    } else {
      applyAnimation({ anim:e.anim }, true);  // 只做身体动作、不换脸
      if(microRestoreTimer) clearTimeout(microRestoreTimer);
      var wasMood=mood;
      microRestoreTimer=setTimeout(function(){
        microRestoreTimer=null;
        if(mood===wasMood) applyAnimation(moodObj(mood), false);   // 期间状态变了就别抢
      }, e.ms||1200);
    }
    if(e.fx) fx(e.fx);
    if(e.line&&state.autoSpeak) speak(lineFor('micro:'+e.id, e.line),{ durationMs:(e.ms||1200)+1400 });
  }
  function scheduleMicro(){
    if(microTimer){ clearTimeout(microTimer); microTimer=null; }
    var min=CFG.behavior.idleMicroMinMs||16000;
    var max=Math.max(min, CFG.behavior.idleMicroMaxMs||34000);
    microTimer=setTimeout(function(){
      microTimer=null;
      // 只有"真闲"的时候才自娱自乐：不在后台标签、没被隐藏、没在说话、当前就是待机
      if(!document.hidden&&!isHidden()&&!bubbleVisible&&!transient&&resolveMood()==='idle') microAction(pickMicro());
      scheduleMicro();
    }, min+Math.random()*(max-min));
  }

  // ---------- 构建 DOM ----------
  function dedupeStyles(){
    // 热重载可能留下多份同 id 样式块，只保留最后（最新）一份
    try{
      var all=document.querySelectorAll('#dsh-whale-girl-style');
      for(var i=0;i<all.length-1;i++){ if(all[i].parentNode) all[i].parentNode.removeChild(all[i]); }
    }catch(e){}
  }
  function build(){
    var existing=document.getElementById('dsh-whale-girl-root');
    if(existing&&existing.parentNode) existing.parentNode.removeChild(existing); // 热重载/重复注入只保留一份
    closeMenu(); closePanel();

    root=document.createElement('div');
    root.id='dsh-whale-girl-root';
    root.className='dgw-root dgw-mood-idle'+(state.still?' dgw-still':'');
    root.setAttribute('data-dgw','whale-girl');
    root.style.left=state.pos.left+'px';
    root.style.top=state.pos.top+'px';

    stage=document.createElement('div'); stage.className='dgw-stage';
    attn=document.createElement('div'); attn.className='dgw-attn';
    gazeEl=document.createElement('div'); gazeEl.className='dgw-gaze';
    anim=document.createElement('div'); anim.className='dgw-anim';

    img=document.createElement('img');
    img.className='dgw-img'; img.alt='DeepSeek 鲸鱼娘看板娘'; img.draggable=false;
    img.style.height=canvasH()+'px';
    anim.appendChild(img);

    // 视频绝对定位覆盖在立绘之上（立绘负责撑出画布尺寸），初始隐藏用 class，不用 display
    video=document.createElement('video');
    video.className='dgw-video dgw-off'; video.muted=true; video.loop=true; video.playsInline=true;
    video.setAttribute('muted',''); video.setAttribute('playsinline','');
    video.setAttribute('aria-hidden','true'); video.preload='auto';
    video.style.height=canvasH()+'px';
    anim.appendChild(video);

    gazeEl.appendChild(anim);
    attn.appendChild(gazeEl);
    stage.appendChild(attn);

    // 命中层：只有角色剪影区域接收鼠标事件，透明留白点击穿透到 dsh 界面
    hit=document.createElement('div'); hit.className='dgw-hit';
    // 无障碍：角色可 Tab 聚焦，回车说话 / 方向键挪位 / H 隐藏（键位在 bindEvents 里）
    if(!CFG.a11y||CFG.a11y.keyboard!==false){
      hit.setAttribute('tabindex','0');
      hit.setAttribute('role','button');
      hit.setAttribute('aria-label','DeepSeek 鲸鱼娘看板娘：回车让她说话，方向键移动位置，H 隐藏');
    }
    stage.appendChild(hit);

    root.appendChild(stage);
    (document.querySelector(CFG.mountTarget)||document.body).appendChild(root);

    applyVisual();
    bindEvents();
    bootTheme();
    bootVideo();
    bootBridge();
    scheduleAct();   // 休闲动作调度（动态待机动作）
    startEdgeWatch();   // 贴边停留触发（拖到墙边就会演）
    bootTimers();
    bootSensors();
    setMood('idle',{ silent:true, force:true });
    setTimeout(preload, 1200);
    greet();
  }

  function applyVisual(){
    var h=canvasH()*state.scale;
    if(img) img.style.height=Math.round(h)+'px';
    if(video) video.style.height=Math.round(h)+'px';
    if(root){ root.style.opacity=state.opacity; root.style.left=state.pos.left+'px'; root.style.top=state.pos.top+'px'; }
    clampPos();
  }
  function clampPos(){
    var W=window.innerWidth||1280, H=window.innerHeight||800;
    var w=canvasW()*state.scale, h=canvasH()*state.scale;
    state.pos.left=clamp(state.pos.left, -w*0.35, W-w*0.65);
    state.pos.top=clamp(state.pos.top, 0, H-h*0.5);
    if(root){ root.style.left=state.pos.left+'px'; root.style.top=state.pos.top+'px'; }
    updateEdgePeek();   // 位置一变就重算"贴边探头"
  }
  function hide(){
    stopAct(true);   // 藏起来就停（别在看不见的地方空转）
    if(!root) return;
    root.style.visibility='hidden';   // 不用 display:none：保持盒尺寸，位置/命中计算不失真
    if(video&&!video.paused){ try{ video.pause(); }catch(e){} }   // 藏起来就别解码了
    // 藏起来时把气泡/口型/菜单/面板一起收掉，避免"看不见还在跑"和唤回后突然冒出旧气泡
    if(bubble){ bubble.style.display='none'; }
    bubbleVisible=false;
    stopLip();
    if(bubbleTimer){ clearTimeout(bubbleTimer); bubbleTimer=null; }
    closeMenu(); closePanel();
  }
  function show(){
    if(!root) return;
    root.style.visibility='visible';
    touchActivity();
    setMood('idle',{ force:true });
    ensurePlaying();
  }
  /** 任何"该动却在停"的时刻都走这里：唤醒 + 恢复播放 + 重新同步视觉。 */
  function ensureMotion(){
    lastActivity=now();
    wakeUp();
    syncVisual(true);
    ensurePlaying();
  }
  function isHidden(){ return root?root.style.visibility==='hidden':false; }

  // ---------- 交互：拖拽 / 点击 / 双击 / 右键 ----------
  function onDown(e){
    stopAct(true);   // 一点就走：休闲动作永远让位于用户操作
    if(e.button!==0) return;
    drag.on=true; drag.moved=false; drag.down=true;
    drag.sx=e.clientX; drag.sy=e.clientY; drag.ox=state.pos.left; drag.oy=state.pos.top;
    e.preventDefault();
  }
  function onMove(e){
    if(state.followCursor){ attnState.tx=e.clientX; attnState.ty=e.clientY; if(!attnState.raf){ attnState.raf=true; requestAnimationFrame(tickAttn); } }
    sampleSpeed(e);
    maybeStartle(e);
    if(!drag.on) return;
    var dx=e.clientX-drag.sx, dy=e.clientY-drag.sy;
    if(!drag.moved&&Math.abs(dx)<4&&Math.abs(dy)<4) return;
    drag.moved=true;
    if(state.locked) return;
    var frameDx=e.clientX-(drag.px===undefined?e.clientX:drag.px);   // 这一帧的水平位移
    var frameDy=e.clientY-(drag.py===undefined?e.clientY:drag.py);
    drag.vx=frameDx; drag.vy=frameDy;                                 // 留给松手后的惯性滑动
    dragTiltTo(frameDx);
    drag.px=e.clientX; drag.py=e.clientY;
    state.pos.left=drag.ox+dx; state.pos.top=drag.oy+dy;
    clampPos();
  }
  /** 鼠标"快速逼近"时的吓一跳反应（进入半径 + 200ms 内逼近足够远，且过了冷却）。 */
  function maybeStartle(e){
    if(!CFG.behavior.startle||!root) return;
    var r=root.getBoundingClientRect();
    var cx=r.left+r.width/2, cy=r.top+r.height*0.3;
    var d=Math.sqrt((e.clientX-cx)*(e.clientX-cx)+(e.clientY-cy)*(e.clientY-cy));
    var t=now();
    var prev=approach.d;
    approach.d=d; approach.t=t;
    var radius=CFG.behavior.startleRadiusPx||150;
    if(d>radius+80){ approach.armed=true; return; }      // 离开范围后重新武装，避免反复触发
    if(!approach.armed||d>radius) return;
    if(t-startleAt<(CFG.behavior.startleCooldownMs||6000)) return;
    // 200ms 内距离骤减 → 判定为"扑过来"
    if(prev===null){ return; }
    var need=CFG.behavior.startleApproachPx||90;
    if(prev-d<need) return;
    approach.armed=false;
    startleAt=t;
    microAction({ id:'startle', anim:'pop', ms:700, fx:'question' });
    if(CHAR.interact.startle&&state.autoSpeak) speak(pickFrom(poolFor('interact.startle', CHAR.interact.startle)),{ force:true });
  }
  function onUp(){
    // 注意：onUp 绑在 document 上，页面**任何地方**松开鼠标都会走到这里。
    // 早前把 stopAct 放在这里，导致"没点到她也莫名其妙结束"——保持态只该由
    // ① 点她（onDown，绑在 stage 上）② 把她拖离边缘（sustain 判定）来结束。
    if(!drag.on) return;
    drag.on=false;
    drag.px=undefined;
    if(drag.moved&&!state.locked){
      saveState();
      speak(pickFrom(poolFor('interact.drag', CHAR.interact.drag)));
      dragTiltReset();
      glide();   // 甩出去的回弹：按最后一帧速度滑一小段
      microAction({ id:'settle', anim:'pop', ms:(CFG.behavior.dragSettleMs||460) });   // 落位小弹跳
    } else {
      dragTiltReset();
    }
  }
  /** 按点击落点分区（头 / 身体 / 尾巴）——同一只看板娘，摸哪儿反应不一样。 */
  function clickZone(e){
    if(!CFG.behavior.clickZones||!stage) return null;
    var r=stage.getBoundingClientRect();
    if(!r.width||!r.height) return null;
    var fx=(e.clientX-r.left)/r.width;
    var fy=(e.clientY-r.top)/r.height;
    if(fy<0.32) return 'head';           // 上半部偏上是头
    if(fx>0.70) return 'tail';           // 右侧是鲸鱼尾巴
    return 'body';
  }
  // 单击分级：按落点分区说话；连点第 3 次"咦？" → 第 5 次生气
  function onClick(e){
    if(drag.moved) return;
    touchActivity();
    var t=now();
    clicks.push(t);
    while(clicks.length&&t-clicks[0]>CFG.angryWindowMs) clicks.shift();
    var n=clicks.length;
    var angryAt=CFG.behavior.clickAngryAt||CFG.angryClicks||5;
    if(CFG.angry&&state.angry&&n>=angryAt){
      clicks=[];
      userTransient('angry', (CFG.behavior.transientMs&&CFG.behavior.transientMs.angry)||CFG.angryHoldMs);
      speak(pickFrom(poolFor('mood:angry', moodObj('angry').pool)),{ force:true });
      return;
    }
    if(n===(CFG.behavior.clickThinkAt||3)){
      userTransient('thinking', (CFG.behavior.transientMs&&CFG.behavior.transientMs.think)||1300);
      speak(pickFrom(poolFor('interact.think', CHAR.interact.think)),{ force:true });
      return;
    }
    // v0.13.6：单击不再触发台词（用户要求）——只按落点给一个不同的"戳一下"视觉反应；
    // 连点第 3 次（咦？）与第 5 次（生气）的台词保留在上面两个分支里。
    var zone=clickZone(e);
    microAction({ id:'poke', anim:(zone==='tail'?'lean':(zone==='head'?'pop':'pop')), ms:(CFG.behavior.transientMs&&CFG.behavior.transientMs.poke)||800 });
  }
  /** 下一个表情（双击循环用）。 */
  function nextMoodId(){
    var i=MOOD_IDS.indexOf(mood);
    return MOOD_IDS[(i+1)%MOOD_IDS.length];
  }
  function onDblClick(){
    touchActivity();
    clicks=[];   // 双击是"换表情"，不该算进连点生气的计数
    demoMood(nextMoodId(), CFG.previewHoldMs);   // 双击：限时演示 + 说这个情绪自己的台词（不做状态报幕）
  }
  /**
   * 演示某个情绪：限时瞬态（到点回真实状态）+ 说一句该情绪自己的台词。
   * 刻意不做状态报幕（把状态名念出来那种）：表情本身就是信息，台词只负责演角色。
   */
  function demoMood(id, holdMs){
    if(!CHAR.moods[id]) return;
    sleeping=false;
    flash(id, holdMs, true, { silent:true });          // silent：避免 setMood 自己再抢一句
    var pool=moodObj(id).pool;
    if(pool&&pool.length) speak(pickFrom(poolFor('mood:'+id, pool)),{ force:true });
  }
  function onCtx(e){ e.preventDefault(); showMenu(e.clientX,e.clientY); }

  /** 页面滚动时视线跟着内容走（不需要鼠标也动）。 */
  /**
   * 位置感知：角色贴住哪条边（把视口边界当"墙"）。
   * 返回 { side:'left'|'right'|null, bottom:boolean }。
   */
  function edgeState(){
    var st={ side:null, bottom:false };
    if(!root) return st;
    var within=(CFG.behavior&&CFG.behavior.edgePeekWithinPx)||14;
    var r=root.getBoundingClientRect();
    var W=window.innerWidth||1280, H=window.innerHeight||800;
    if(r.left<=within) st.side='left';
    else if(r.right>=W-within) st.side='right';
    st.bottom=(r.bottom>=H-within);
    return st;
  }
  function onWheel(e){
    if(!CFG.behavior.scrollGaze||!state.followCursor) return;
    var h=window.innerHeight||800;
    attnState.ty=clamp(attnState.ty+(e.deltaY||0)*0.35, 0, h);
    if(!attnState.raf){ attnState.raf=true; requestAnimationFrame(tickAttn); }
  }
  function applyAttnTransform(){
    if(!attn) return;
    attn.style.transform='translate('+attnState.cx.toFixed(1)+'px,'+attnState.cy.toFixed(1)+'px) scale('+hoverScaleCur.toFixed(3)+')';
    applyGazeTransform();
  }
  /**
   * 伪 3D 转头：透视 + rotateY(左右) / rotateX(上下)，枢轴放脖子上。
   * 必须作用在 gazeEl 而不是 anim 上——anim 上跑着 transform 关键帧动画，
   * CSS 动画会覆盖内联 transform，写在那里会被浮动动画吃掉。
   */
  function applyGazeTransform(){
    if(!gazeEl) return;
    var g=CFG.gaze||{};
    var lookOn=!(g.enabled===false)&&!!state.followCursor&&!reduced&&!state.still;
    var yawDeg=(lookOn?gaze.yaw:0)+actPose.yaw;
    var pitchDeg=(lookOn?gaze.pitch:0)+actPose.pitch;
    var tx=actPose.x, ty=actPose.y;
    var sc=actPose.scale;
    if(!lookOn&&!actCurrent&&tx===0&&ty===0&&sc===1){ gazeEl.style.transform=''; return; }
    // 素材本身朝屏幕外看，所以**左边缘镜像、右边缘用原图**（v0.13.4 实测修正）
    var sx=sc*(actPose.side>0?-1:1);
    gazeEl.style.transform='translate('+tx.toFixed(1)+'px,'+ty.toFixed(1)+'px) perspective('+(g.perspectivePx||700)+'px) rotateY('+yawDeg.toFixed(2)+'deg) rotateX('+pitchDeg.toFixed(2)+'deg) scale('+sx.toFixed(3)+','+sc.toFixed(3)+')';
  }
  /** 清空休闲动作姿态（中止 / 结束时调用）。 */
  function resetActPose(){
    actPose.x=0; actPose.y=0; actPose.yaw=0; actPose.pitch=0; actPose.scale=1; actPose.reveal=1; actPose.side=0;
  }
  /**
   * 由“鼠标相对头部中心的方向”算转头角度。用饱和函数而不是除法：
   * dx/(|dx|+k) 天然落在 (-1,1)，鼠标离得再远也不会转过头。
   */
  function updateGaze(dx, dy, rect){
    var g=CFG.gaze||{};
    if(g.enabled===false||!state.followCursor||reduced||state.still){
      gaze.yaw+=(0-gaze.yaw)*0.2; gaze.pitch+=(0-gaze.pitch)*0.2;
      return;
    }
    var spanX=Math.max(60, rect.width*0.9), spanY=Math.max(60, rect.height*0.6);
    var nx=dx/(Math.abs(dx)+spanX);
    var ny=dy/(Math.abs(dy)+spanY);
    var targetYaw=nx*(g.maxYawDeg||7)*speedLook;
    var targetPitch=-ny*(g.maxPitchDeg||4)*speedLook;   // 鼠标在上 → 抬头
    var k=g.smooth||0.18;
    gaze.yaw+=(targetYaw-gaze.yaw)*k;
    gaze.pitch+=(targetPitch-gaze.pitch)*k;
  }
  function tickAttn(){
    attnState.raf=false;
    if(!root||!state.followCursor) return;
    var r=root.getBoundingClientRect();
    var cx=r.left+r.width/2, cy=r.top+r.height*0.28; // 视线以头部为基准
    var dx=attnState.tx-cx, dy=attnState.ty-cy;
    var len=Math.sqrt(dx*dx+dy*dy)||1;
    var off=Math.min(len, CFG.lookMaxOffset*speedLook);   // 鼠标越快，视线跟得越紧（speedMood 的 look 档）
    var tx=dx/len*off, ty=dy/len*off*0.6;
    attnState.cx+=(tx-attnState.cx)*CFG.lookSmooth;
    attnState.cy+=(ty-attnState.cy)*CFG.lookSmooth;
    updateGaze(dx, dy, r);
    applyAttnTransform();
  }
  /** 悬停轻微放大：用短程补间，避免突然跳一下。 */
  function tweenHover(target){
    hoverTarget=target;
    if(hoverRaf) return;
    var step=function(){
      var d=hoverTarget-hoverScaleCur;
      if(Math.abs(d)<0.002){ hoverScaleCur=hoverTarget; hoverRaf=false; applyAttnTransform(); return; }
      hoverScaleCur+=d*0.3;
      applyAttnTransform();
      hoverRaf=true;
      requestAnimationFrame(step);
    };
    hoverRaf=true;
    requestAnimationFrame(step);
  }
  /** 拖拽时的物理感：按水平速度倾斜，松手回正 + 落位小弹跳。 */
  function applyTilt(){
    if(!stage) return;
    var total=dragTilt+edgeTilt;
    stage.style.transform=total===0?'':('rotate('+total.toFixed(2)+'deg)');
  }
  function dragTiltTo(dxPx){
    var max=CFG.behavior.dragTiltMaxDeg||0;
    if(max<=0) return;
    var target=clamp(-dxPx*0.35, -max, max);
    dragTilt+=(target-dragTilt)*0.35;
    applyTilt();
  }
  function dragTiltReset(){
    dragTilt=0;
    applyTilt();
  }
  /** 贴到屏幕左右边缘时朝屏幕内"探头"（配合拖拽倾斜用同一个 transform 通道）。 */
  function updateEdgePeek(){
    if(!root||!CFG.behavior.edgePeek){ edgeTilt=0; applyTilt(); return; }
    var within=CFG.behavior.edgePeekWithinPx||14;
    var deg=CFG.behavior.edgePeekDeg||7;
    var r=root.getBoundingClientRect();
    var W=window.innerWidth||1280;
    var next=0;
    if(r.left<=within) next=deg;              // 贴左边 → 朝右（屏幕内）倾
    else if(r.right>=W-within) next=-deg;     // 贴右边 → 朝左倾
    if(next!==edgeTilt){ edgeTilt=next; applyTilt(); }
  }
  /** 松手后的惯性滑动：按最后一帧速度滑一小段，越滑越慢。 */
  function glide(){
    if(!CFG.behavior.dragInertia) return;
    var vx=drag.vx||0, vy=drag.vy||0;
    if(Math.abs(vx)<2&&Math.abs(vy)<2) return;
    var left=14;
    var step=function(){
      if(left--<=0){ saveState(); return; }
      vx*=0.8; vy*=0.8;
      state.pos.left+=vx; state.pos.top+=vy;
      clampPos(); updateEdgePeek();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- 鼠标转速 -> 情绪分档（speedMood） ----------
  function speedTier(v){
    var tiers=CFG.behavior.speedMood;
    if(!tiers||!tiers.length) return { mood: v>CFG.dizzySpeedThreshold?(CFG.behavior.dizzyMood||'dizzy'):null, look:1 };
    for(var i=0;i<tiers.length;i++){ if(v<=tiers[i].max) return tiers[i]; }
    return tiers[tiers.length-1];
  }
  function sampleSpeed(e){
    if(!state.dizzy){ speedLook=1; return; }
    var t=performance.now();
    if(t-speed.lastSample<16) return;
    speed.lastSample=t;
    speed.pts.push({ x:e.clientX, y:e.clientY, t:t });
    var win=CFG.dizzyWindowMs||140;
    while(speed.pts.length&&t-speed.pts[0].t>win) speed.pts.shift();
    if(speed.pts.length<4) return;              // 样本太少不判定（防单点抖动误触发）
    var dist=0;
    for(var i=1;i<speed.pts.length;i++){
      var a=speed.pts[i-1], b=speed.pts[i];
      dist+=Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
    }
    var span=(speed.pts[speed.pts.length-1].t-speed.pts[0].t)||1;
    var v=dist/span;
    var tier=speedTier(v)||{};
    speedLook=tier.look||1;
    // "够快"还不够：窗口内累计位移也要够远，否则原地小幅抖动会被当成甩鼠标
    var fast=!!tier.mood&&dist>=(CFG.dizzyMinDistancePx||0);
    var dizzyMood=tier.mood||CFG.behavior.dizzyMood||'dizzy';
    if(fast){
      dizzy.recover=0;
      if(!dizzy.on){ dizzy.on=true; dizzy.since=t; }
      if(dizzy.on&&(t-dizzy.since)>=CFG.dizzyHoldMs&&mood!==dizzyMood&&t>dizzy.until){
        dizzy.until=t+CFG.dizzyMaxMs;
        userTransient(dizzyMood, (CFG.behavior.transientMs&&CFG.behavior.transientMs.dizzy)||CFG.dizzyMaxMs);
        fx(dizzyMood==='dizzy'?'spin':'dot');
      }
    } else {
      dizzy.since=0;
      if(dizzy.on){
        if(!dizzy.recover) dizzy.recover=t;
        if((t-dizzy.recover)>=(CFG.dizzyRecoverMs||600)){
          dizzy.on=false; dizzy.recover=0;
          if(mood===dizzyMood||mood==='dizzy'){ transient=null; refresh(); }
        }
      }
    }
  }

  // ---------- DOM 感知 AI 状态 ----------
  /** 错误行的"签名"：dsh 的错误行是**留在对话里**的，所以不能当持续状态用，只能当一次性事件。 */
  function errorSignature(){
    var sel=CFG.sensors.error;
    if(!sel) return '';
    try{
      var list=document.querySelectorAll(sel);
      if(!list.length) return '';
      var last=list[list.length-1];
      return list.length+':'+String(last.textContent||'').replace(/\s+/g,' ').slice(0,160);
    }catch(e){ return ''; }
  }
  function evaluateSensors(){
    // 事件桥在说话时不参与决策：两套逻辑同时改状态只会互相打架（桥断流后这里自动接手）
    if(bridgeFresh()) return;
    var prev=sensorMood;
    // 1) 出错 = 一次性事件（带签名去重）。若把 .turnErrorRow 当状态，
    //    第一次报错之后错误行会一直留在 DOM 里 → 看板娘永远卡在难过表情上（用户报的"卡死不动"）。
    var errSig=errorSignature();
    if(errSig==='') errorKey='';
    else if(errSig!==errorKey){ errorKey=errSig; transient=null; flash('error', CFG.errorHoldMs, true); }
    // 2) 持续状态：working / thinking / listening
    var next=null;
    var order=['working','thinking','listening'];
    for(var i=0;i<order.length;i++){
      var key=order[i], sel=CFG.sensors[key];
      if(sel&&safeQuery(sel)){ next=key; break; }
    }
    if(next===prev) return;
    if(next==='working'){
      workSince=now();
      if(settleTimer){ clearTimeout(settleTimer); settleTimer=null; }
    }
    if(prev==='working'&&(next===null||next==='listening'||next==='thinking')){
      // 从"干活"落回：稍等一下再判定是不是"完成"，避免读一次文件就欢呼
      var spent=now()-workSince;
      if(settleTimer) clearTimeout(settleTimer);
      settleTimer=setTimeout(function(){
        settleTimer=null;
        if(sensorMood===null&&spent>=800){ transient=null; refresh(); flash('success', CFG.successHoldMs, true); }
        else refresh();
      }, CFG.sensorSettleMs);
    }
    sensorMood=next;
    refresh();
  }
  function debounceSensors(){
    if(sensorTimer) clearTimeout(sensorTimer);
    sensorTimer=setTimeout(evaluateSensors, CFG.sensorDebounceMs);
  }
  function bootSensors(){
    try{
      sensorObserver=new MutationObserver(function(){ debounceSensors(); });
      sensorObserver.observe(document.documentElement,{ childList:true, subtree:true, attributes:true,
        attributeFilter:['class','data-streaming','data-status','data-content-phase','data-reasoning','data-turn-error'] });
    }catch(e){}
    document.addEventListener('focusin',debounceSensors,true);
    document.addEventListener('focusout',debounceSensors,true);
    sensorFocusIn=debounceSensors;
    setTimeout(evaluateSensors, 900);
  }

  // ---------- 主题跟随 ----------
  function bootTheme(){
    if(!CFG.followTheme){ return; }
    var apply=function(){
      if(!root) return;
      var dark=safeQuery(CFG.darkSelector);
      if(dark) root.classList.add('dgw-dark'); else root.classList.remove('dgw-dark');
      // 菜单/面板挂在 body 下，需要自己带上主题类
      if(menu) menu.className='dgw-menu'+(dark?' dgw-dark':'');
      if(panel) panel.className='dgw-panel'+(dark?' dgw-dark':'');
    };
    themeApply=apply;
    apply();
    try{
      themeObserver=new MutationObserver(apply);
      themeObserver.observe(document.documentElement,{ attributes:true, attributeFilter:['class','data-ds-dark-theme','style'] });
      if(document.body) themeObserver.observe(document.body,{ attributes:true, attributeFilter:['class','data-ds-dark-theme'] });
    }catch(e){}
  }

  // ---------- 定时：闲置发言 / 入睡 / 时段问候 ----------
  /** 从打盹中醒来：说一句醒来台词（比默默切回待机更有"被叫醒"的感觉）。 */
  function wakeUp(){
    if(!sleeping) return;
    sleeping=false;
    refresh();
    var pool=CHAR.interact&&CHAR.interact.wake;
    if(pool&&pool.length&&state.autoSpeak) speak(pickFrom(poolFor('interact.wake', pool)),{ force:true });
  }
  function touchActivity(){ lastActivity=now(); wakeUp(); }
  function resetIdleSpeak(){
    if(idleSpeakTimer) clearTimeout(idleSpeakTimer);
    idleSpeakTimer=setTimeout(function(){
      if((mood==='idle'||mood==='listening')&&!isHidden()) speak(pickFrom(poolFor('random', CHAR.random)));
      resetIdleSpeak();
    }, CFG.idleSpeakIntervalMs);
  }
  function bootTimers(){
    resetIdleSpeak();
    scheduleMicro();   // 待机小动作：让"待机"保持生动
    sleepTimer=setInterval(function(){
      if(isHidden()) return;
      // 兜底自愈：感知识别本来就依赖 DOM 变化，30s 至少重算一次，
      // 避免中断的回合把 thinking/working 永久钉住（表现为"一直卡在那个表情"）。
      evaluateSensors();
      if(effectiveSensor()) { lastActivity=now(); return; }
      if(!sleeping&&now()-lastActivity>=CFG.idleToSleepAfterMs){ sleeping=true; refresh(); }
    }, 30000);
    document.addEventListener('visibilitychange',function(){
      if(document.hidden){
        if(video&&!video.paused){ try{ video.pause(); }catch(e){} }
          } else {
        lastActivity=now();   // 从后台切回来不该立刻又睡着
            syncVisual(true);     // 回到前台：重新判定该显示视频还是立绘
        ensurePlaying();
      }
    });
    // 看门狗：只要"应该动"的视频在暂停（自动播放策略、合成器抽风、切换竞态……），就拉回来
    watchdogTimer=setInterval(function(){
      if(document.hidden||isHidden()) return;
      if(desiredVisual().kind==='video'){ stillSince=0; ensurePlaying(); }
    }, 1500);
    liveTimers.push(sleepTimer, watchdogTimer);
  }
  function greet(){
    if(greetDone) return;
    greetDone=true;
    var h=(new Date()).getHours();
    var seg=(h>=5&&h<11)?'morning':((h>=11&&h<14)?'noon':((h>=14&&h<18)?'afternoon':'night'));
    var pool=CHAR.time[seg]||CHAR.time.morning;
    setTimeout(function(){ speak(pickFrom(poolFor('time:'+seg, pool))); }, 1400);
  }

  // ---------- 右键菜单 ----------
  function isDark(){ return root?root.classList.contains('dgw-dark'):false; }
  function showMenu(x,y){
    closeMenu();
    menu=document.createElement('div'); menu.className='dgw-menu'+(isDark()?' dgw-dark':'');
    var items=[
      { t:'\\u{1F4AC} 说句话', f:function(){ closeMenu(); speak(pickFrom(poolFor('mood:'+mood, moodObj(mood).pool).concat(poolFor('interact.click', CHAR.interact.click))),{ force:true }); } },
      { t:'\\u2699\\uFE0F 设置面板', f:function(){ closeMenu(); openPanel(); } },
      { sep:true },
      { t:'\\u{1F4A4} 先隐藏（Alt+Shift+W 唤回）', f:function(){ closeMenu(); hide(); } }
    ];
    items.forEach(function(it){
      if(it.sep){ var s=document.createElement('div'); s.className='dgw-menu-sep'; menu.appendChild(s); return; }
      var d=document.createElement('div'); d.className='dgw-menu-item'; d.textContent=it.t;
      d.addEventListener('click',it.f); menu.appendChild(d);
    });
    document.body.appendChild(menu);
    var w=menu.offsetWidth, h=menu.offsetHeight;
    menu.style.left=clamp(x,6,window.innerWidth-w-6)+'px';
    menu.style.top=clamp(y,6,window.innerHeight-h-6)+'px';
    setTimeout(function(){
      var off=function(ev){ if(menu&&!menu.contains(ev.target)) { closeMenu(); document.removeEventListener('mousedown',off,true); } };
      document.addEventListener('mousedown',off,true);
    },0);
  }
  function closeMenu(){ if(menu&&menu.parentNode) menu.parentNode.removeChild(menu); menu=null; }

  // ---------- 设置面板 ----------
  function openPanel(){
    if(panel&&panel.parentNode){ closePanel(); return; }
    closePanel();
    panel=document.createElement('div'); panel.className='dgw-panel'+(isDark()?' dgw-dark':'');
    var html='';
    html+='<div class="dgw-panel-head" title="拖动这里移动面板 · 双击回到默认位置"><span class="dgw-panel-titlebar"><span class="dgw-panel-grip">\\u283F</span>DeepSeek 鲸鱼娘</span><button type="button" class="dgw-panel-close" aria-label="关闭">\\u00D7</button></div>';
    html+='<div class="dgw-panel-body">';
    html+=row(t('ui:scale','缩放'),'<input type="range" min="'+CFG.minScale+'" max="'+CFG.maxScale+'" step="0.05" value="'+state.scale+'" data-k="scale">');
    html+=row(t('ui:opacity','不透明度'),'<input type="range" min="0.25" max="1" step="0.05" value="'+state.opacity+'" data-k="opacity">');
    html+=row(t('ui:autoSpeak','自动说话'),'<input type="checkbox" '+(state.autoSpeak?'checked':'')+' data-k="autoSpeak">');
    // v0.15.3：暂时不显示"视线跟随"开关 —— 真·眼珠跟随层已回滚，现在只剩很轻微的伪 3D 转头，
    // 留着开关容易被当成"点了没用/没效果"。功能本身仍按 state.followCursor 生效，改配置即可放回。
    if(CFG.showFollowCursorToggle) html+=row(t('ui:followCursor','视线跟随'),'<input type="checkbox" '+(state.followCursor?'checked':'')+' data-k="followCursor">');
    html+=row(t('ui:dizzy','头晕反馈'),'<input type="checkbox" '+(state.dizzy?'checked':'')+' data-k="dizzy">');
    html+=row(t('ui:angry','连点生气'),'<input type="checkbox" '+(state.angry?'checked':'')+' data-k="angry">');
    html+=row(t('ui:idleMotion','待机动画'),'<input type="checkbox" '+(state.idleMotion==='video'?'checked':'')+' data-k="idleMotion">');
    html+=row(t('ui:bridge','事件桥（更准）'),'<input type="checkbox" '+(state.bridge?'checked':'')+' data-k="bridge">');
    html+=row(t('ui:locked','锁定位置'),'<input type="checkbox" '+(state.locked?'checked':'')+' data-k="locked">');
    html+=row(t('ui:still','完全静止（无障碍）'),'<input type="checkbox" '+(state.still?'checked':'')+' data-k="still">');
    html+=row(t('ui:lang','台词语言'),'<select data-k="lang">'+
      '<option value="auto"'+(state.lang==='auto'?' selected':'')+'>'+t('ui:langAuto','自动（跟随界面）')+'</option>'+
      '<option value="zh"'+(state.lang==='zh'?' selected':'')+'>'+t('ui:langZh','中文')+'</option>'+
      Object.keys(LOCALES).map(function(l){ return '<option value="'+l+'"'+(state.lang===l?' selected':'')+'>'+l.toUpperCase()+'</option>'; }).join('')+
      '</select>');
    html+='<div class="dgw-panel-title">'+t('ui:moods','表情预览')+'</div><div class="dgw-mood-list"></div>';
    html+='<div class="dgw-panel-title">'+t('ui:position','位置')+'</div><div><button type="button" class="dgw-ghost" data-act="reset">'+t('ui:reset','回到右下角')+'</button> <button type="button" class="dgw-ghost" data-act="hide">'+t('ui:hide','隐藏')+'</button></div>';
    html+='<details class="dgw-dialogue"><summary class="dgw-panel-title">'+t('ui:dialogue','台词（本地覆写）')+'</summary><div class="dgw-dialogue-body">';
    html+='<div class="dgw-panel-row"><span class="dgw-panel-label">台词池</span><select data-dlg="pick" class="dgw-dlg-select"></select></div>';
    html+='<textarea data-dlg="text" rows="6" class="dgw-dlg-text" spellcheck="false"></textarea>';
    html+='<div class="dgw-panel-row"><button type="button" class="dgw-ghost" data-dlg="save">'+t('ui:save','保存')+'</button> <button type="button" class="dgw-ghost" data-dlg="reset">'+t('ui:restore','恢复默认')+'</button> <button type="button" class="dgw-ghost" data-dlg="export">'+t('ui:export','复制 JSON')+'</button></div>';
    html+='<div class="dgw-hint">每行一句，保存后立即生效并记住（只存在本机浏览器）。以 # 开头的行会被忽略——那是条件台词，只在这里展示、不在面板里改。</div>';
    html+='</div></details>';
    html+='<div class="dgw-hint">面板可拖动（双击标题栏回到默认位置）· 拖拽角色移动位置 · 单击说话 · 双击换表情 · 右键菜单 · Alt+Shift+W 唤回</div>';
    html+='</div>';
    panel.innerHTML=html;
    panel.querySelector('.dgw-panel-close').addEventListener('click',closePanel);
    applyPanelPos();
    bindPanelDrag(panel.querySelector('.dgw-panel-head'));
    bindDialogueEditor();

    var list=panel.querySelector('.dgw-mood-list');
    MOOD_IDS.forEach(function(id){
      var b=document.createElement('button');
      b.type='button'; b.className='dgw-mood-btn'; b.textContent=moodLabel(id); b.setAttribute('data-mood',id);
      b.addEventListener('click',function(){ demoMood(id, CFG.previewHoldMs*2); });
      list.appendChild(b);
    });

    var inputs=panel.querySelectorAll('[data-k]');
    for(var i=0;i<inputs.length;i++){
      (function(inp){
        inp.addEventListener('input',function(){
          var k=inp.getAttribute('data-k');
          if(inp.type==='checkbox'){
            if(k==='idleMotion') state.idleMotion=inp.checked?'video':'static';
            else state[k]=inp.checked;
          } else if(inp.tagName==='SELECT'){
            state[k]=inp.value;
          } else {
            state[k]=parseFloat(inp.value);
          }
          if(k==='lang'){
            // 换成什么语言，就当场说一句那个语言的台词（比"设置里改了但没感觉"直观）
            speak(pickFrom(poolFor('interact.click', CHAR.interact.click)),{ force:true });
            refresh();
          }
          if(k==='idleMotion'){
            if(state.idleMotion==='video'&&!videoOk){ videoRetries=0; bootVideo(); }   // 重新打开时再给视频一次机会
            syncVisual(true);
          }
          if(k==='bridge'){
            if(state.bridge) bootBridge(); else closeBridge();   // 事件桥开关即时生效
            refresh();
          }
          if(k==='still'){
            if(root) root.classList.toggle('dgw-still',!!state.still);
            syncVisual(true);                          // 切静态立绘 / 恢复视频
            if(state.still) maybeIdlePauseVideo(); else ensurePlaying();
          }
          applyVisual(); saveState();
        });
      })(inputs[i]);
    }
    var acts=panel.querySelectorAll('[data-act]');
    for(var j=0;j<acts.length;j++){
      (function(btn){
        btn.addEventListener('click',function(){
          var a=btn.getAttribute('data-act');
          if(a==='reset'){
            var W=window.innerWidth, H=window.innerHeight;
            state.pos.left=W-CFG.defaultPos.right-canvasW()*state.scale;
            state.pos.top=H-CFG.defaultPos.bottom-canvasH()*state.scale;
            applyVisual(); saveState();
          } else if(a==='hide'){ closePanel(); hide(); }
        });
      })(acts[j]);
    }
    document.body.appendChild(panel);
  }
  function row(label,ctrl){
    return '<div class="dgw-panel-row"><span class="dgw-panel-label">'+label+'</span>'+ctrl+'</div>';
  }
  function closePanel(){ if(panel&&panel.parentNode) panel.parentNode.removeChild(panel); panel=null; }

  // ---------- 台词编辑面板（本地覆写） ----------
  /** 所有可覆写的台词池清单：[key, 显示名]。 */
  function dialoguePoolList(){
    var list=[];
    for(var i=0;i<MOOD_IDS.length;i++) list.push(['mood:'+MOOD_IDS[i], '情绪·'+moodObj(MOOD_IDS[i]).label]);
    ['click','drag','think','wake','startle'].forEach(function(g){ if(CHAR.interact&&CHAR.interact[g]) list.push(['interact.'+g,'交互·'+g]); });
    var zones=(CHAR.interact&&CHAR.interact.zones)||{};
    Object.keys(zones).forEach(function(z){ list.push(['zone:'+z,'点击·'+z]); });
    (CHAR.micro||[]).forEach(function(m){ if(m.line) list.push(['micro:'+m.id,'小动作·'+m.id]); });
    Object.keys((CHAR.bridge&&CHAR.bridge.lines)||{}).forEach(function(p){ list.push(['bridge:'+p,'相位·'+p]); });
    Object.keys(CHAR.time||{}).forEach(function(s){ list.push(['time:'+s,'问候·'+s]); });
    list.push(['random','随机彩蛋']);
    return list;
  }
  /** 某个池子的默认台词（角色自带的）。 */
  function dialogueDefaults(key){
    if(key.indexOf('mood:')===0) return (moodObj(key.slice(5)).pool||[]).slice();
    if(key.indexOf('interact.')===0) return ((CHAR.interact||{})[key.slice(9)]||[]).slice();
    if(key.indexOf('zone:')===0) return (((CHAR.interact||{}).zones||{})[key.slice(5)]||[]).slice();
    if(key.indexOf('micro:')===0){ var m=(CHAR.micro||[]).filter(function(x){ return x.id===key.slice(6); })[0]; return m&&m.line?[m.line]:[]; }
    if(key.indexOf('bridge:')===0) return (((CHAR.bridge||{}).lines||{})[key.slice(7)]||[]).slice();
    if(key.indexOf('time:')===0) return ((CHAR.time||{})[key.slice(5)]||[]).slice();
    if(key==='random') return (CHAR.random||[]).slice();
    return [];
  }
  /** 当前生效的台词（覆写优先），条件条目以 # 行展示为只读。 */
  function dialogueText(key){
    var src=dialogueOverrides[key]||poolFor(key, dialogueDefaults(key));   // 面板显示的语言要和实际说的一致
    var out=[];
    for(var i=0;i<src.length;i++){
      var e=src[i];
      if(typeof e==='string') out.push(e);
      else if(e&&e.line) out.push('#（条件台词，不可在面板修改）'+e.line);
    }
    return out.join(NL);
  }
  function bindDialogueEditor(){
    if(!panel) return;
    var pick=panel.querySelector('[data-dlg="pick"]');
    var text=panel.querySelector('[data-dlg="text"]');
    if(!pick||!text) return;
    var list=dialoguePoolList();
    var options='';
    for(var i=0;i<list.length;i++) options+='<option value="'+list[i][0]+'">'+list[i][1]+(dialogueOverrides[list[i][0]]?' ✎':'')+'</option>';
    pick.innerHTML=options;
    var fill=function(){ text.value=dialogueText(pick.value); };
    pick.addEventListener('change',fill);
    fill();
    var buttons=panel.querySelectorAll('[data-dlg]');
    for(var j=0;j<buttons.length;j++){
      var b=buttons[j];
      if(b===pick||b===text) continue;
      (function(btn){
        btn.addEventListener('click',function(){
          var act=btn.getAttribute('data-dlg');
          if(act==='save'){
            var lines=sanitizeLines(text.value.split(NL).filter(function(s){ return s.trim().charAt(0)!=='#'; }));
            var defaults=dialogueDefaults(pick.value);
            var same=lines&&lines.length===defaults.filter(function(e){ return typeof e==='string'; }).length&&lines.join(NL)===defaults.filter(function(e){ return typeof e==='string'; }).join(NL);
            if(!lines||same) delete dialogueOverrides[pick.value];   // 和默认一样就别存覆写了
            else dialogueOverrides[pick.value]=lines;
            saveDialogueOverrides();
            speak(pickFrom(poolFor('interact.click', CHAR.interact.click)),{ force:true });
          } else if(act==='reset'){
            delete dialogueOverrides[pick.value];
            saveDialogueOverrides();
            fill();
          } else if(act==='export'){
            var json=JSON.stringify(dialogueOverrides,null,2);
            try{
              if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(json);
              else if(window.prompt) window.prompt('台词覆写 JSON（复制走即可）：',json);
            }catch(e){ if(CFG.debug) console.log(json); }
          }
          // 重新渲染一遍（✎ 标记 / 文本回填）
          closePanel(); openPanel();
        });
      })(b);
    }
  }

  // ---------- 设置面板：可拖拽（位置记忆）----------
  /** 把记忆的面板位置应用上去（null = 用 CSS 默认的右下角）。 */
  function applyPanelPos(){
    if(!panel) return;
    var p=state.panelPos;
    if(p&&typeof p.left==='number'&&typeof p.top==='number'){
      panel.style.left=p.left+'px'; panel.style.top=p.top+'px';
      panel.style.right='auto'; panel.style.bottom='auto';
    } else {
      panel.style.left=''; panel.style.top=''; panel.style.right=''; panel.style.bottom='';
    }
  }
  function clampPanel(){
    if(!panel||!state.panelPos) return;
    var W=window.innerWidth, H=window.innerHeight;
    var w=panel.offsetWidth, h=panel.offsetHeight;
    state.panelPos.left=clamp(state.panelPos.left, 4, Math.max(4,W-w-4));
    state.panelPos.top=clamp(state.panelPos.top, 4, Math.max(4,H-h-4));
    panel.style.left=state.panelPos.left+'px'; panel.style.top=state.panelPos.top+'px';
  }
  /** 表头按住即可拖动面板；双击表头回到默认位置。 */
  function bindPanelDrag(handle){
    if(!handle) return;
    on(handle,'mousedown',function(e){
      if(e.button!==0||!panel) return;
      if(e.target&&e.target.closest&&e.target.closest('.dgw-panel-close')) return;   // 点关闭按钮不算拖拽
      var r=panel.getBoundingClientRect();
      var offX=e.clientX-r.left, offY=e.clientY-r.top;
      // 从 right/bottom 锚定切成 left/top 锚定，之后拖动只改 left/top
      panel.style.left=r.left+'px'; panel.style.top=r.top+'px';
      panel.style.right='auto'; panel.style.bottom='auto';
      state.panelPos={ left:Math.round(r.left), top:Math.round(r.top) };
      var move=function(ev){
        if(!panel) return;
        var W=window.innerWidth, H=window.innerHeight;
        var w=panel.offsetWidth, h=panel.offsetHeight;
        var nx=clamp(ev.clientX-offX, 4, Math.max(4,W-w-4));
        var ny=clamp(ev.clientY-offY, 4, Math.max(4,H-h-4));
        panel.style.left=nx+'px'; panel.style.top=ny+'px';
        state.panelPos={ left:Math.round(nx), top:Math.round(ny) };
      };
      var up=function(){
        document.removeEventListener('mousemove',move,true);
        document.removeEventListener('mouseup',up,true);
        saveState();
      };
      document.addEventListener('mousemove',move,true);
      document.addEventListener('mouseup',up,true);
      e.preventDefault();
    });
    on(handle,'dblclick',function(e){
      if(e.target&&e.target.closest&&e.target.closest('.dgw-panel-close')) return;
      state.panelPos=null; applyPanelPos(); saveState();
    });
  }

  // ---------- 绑定 ----------
  /** 注册监听并记录，便于 teardown 时全部摘掉（防止重复注入后多个实例互相打架）。 */
  function on(target, ev, fn, opts){
    target.addEventListener(ev, fn, opts);
    liveListeners.push([target, ev, fn, opts]);
  }
  function bindEvents(){
    on(stage,'mousedown',onDown);
    on(document,'mousemove',onMove,{ passive:true });
    on(document,'mouseup',onUp);
    on(stage,'click',onClick);
    on(stage,'dblclick',onDblClick);
    on(stage,'contextmenu',onCtx);
    // 碰它一下 = 唤醒 + 把"该动的"拉回运动状态（含浏览器因自动播放策略暂停后的恢复）
    on(hit,'mouseenter',function(){
      ensureMotion();
      tweenHover(CFG.behavior.hoverScale||1.03);   // 悬停轻微放大：有"被注意到"的手感
    });
    on(hit,'mouseleave',function(){ tweenHover(1); });
    on(hit,'pointerdown',ensureMotion);
    on(stage,'mouseenter',touchActivity);
    ['mousemove','click','keydown','focusin','wheel','touchstart'].forEach(function(ev){
      on(document,ev,touchActivity,{ passive:true });
    });
    // 兜底：任何一次用户手势都可以作为"恢复播放 / 重试加载"的机会
    on(document,'pointerdown',function(){
      if(desiredVisual().kind==='video') ensurePlaying();
      if(!videoOk&&state.idleMotion==='video'&&videoRetries<CFG.videoRetries){ videoRetries++; bootVideo(); }
    },{ passive:true });
    on(window,'resize',function(){ clampPos(); clampPanel(); });
    on(window,'wheel',onWheel,{ passive:true });
    on(document,'keydown',function(e){
      if(e.altKey&&e.shiftKey&&(e.key==='W'||e.key==='w')){ e.preventDefault(); show(); return; }
      onKey(e);
    });
    if(window.matchMedia){
      var mq=window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced=!!mq.matches;
      var onMq=function(e){
        reduced=!!e.matches;
        if(root) root.classList.toggle('dgw-reduced',reduced);
        applyAnimation(moodObj(mood), true);   // 减少动态效果 → 换成极轻呼吸，而不是彻底不动
        syncVisual(true);
      };
      if(mq.addEventListener) on(mq,'change',onMq);
      else if(mq.addListener) mq.addListener(onMq);
    }
  }

  // ---------- 清理（重复注入/卸载时不留残骸） ----------
  function teardown(){
    for(var i=0;i<liveListeners.length;i++){
      try{ liveListeners[i][0].removeEventListener(liveListeners[i][1], liveListeners[i][2], liveListeners[i][3]); }catch(e){}
    }
    liveListeners=[];
    for(var t=0;t<liveTimers.length;t++){ try{ clearInterval(liveTimers[t]); clearTimeout(liveTimers[t]); }catch(e){} }
    liveTimers=[];
    try{ if(sensorObserver) sensorObserver.disconnect(); }catch(e){}
    try{ if(themeObserver) themeObserver.disconnect(); }catch(e){}
    sensorObserver=null; themeObserver=null;
    [transientTimer,sleepTimer,sleepFxTimer,idleSpeakTimer,lipTimer,bubbleTimer,sensorTimer,settleTimer,watchdogTimer,microTimer,microRestoreTimer,typeTimer].forEach(function(x){
      try{ clearTimeout(x); clearInterval(x); }catch(e){}
    });
    transientTimer=sleepTimer=sleepFxTimer=idleSpeakTimer=lipTimer=bubbleTimer=sensorTimer=settleTimer=watchdogTimer=null;
    microTimer=microRestoreTimer=typeTimer=null;
    preloaded=[];
    if(actTimer){ clearTimeout(actTimer); actTimer=null; }
    if(edgeWatchTimer){ clearTimeout(edgeWatchTimer); edgeWatchTimer=null; }
    if(actRaf){ cancelAnimationFrame(actRaf); actRaf=null; }
    actCurrent=null; resetActPose();
    closeBridge();
    if(video){ try{ video.pause(); }catch(e){} }
    if(root&&root.parentNode) root.parentNode.removeChild(root);
    root=stage=attn=anim=img=video=hit=bubble=null;
    menu=null; panel=null;
  }

  /** 键盘无障碍：Tab 聚焦角色后，回车说话、方向键挪位、H 隐藏。 */
  function onKey(e){
    if(!CFG.a11y||CFG.a11y.keyboard===false) return;
    var t=e.target;
    // 别抢 dsh 输入框的键：焦点在输入控件里时只有 H 仍然生效
    var focused=!!(hit&&document.activeElement===hit);
    var typing=!!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable));
    if(!focused&&typing) return;
    var isHide=(e.key==='h'||e.key==='H');
    if(!focused&&!isHide) return;
    var step=8;
    if(e.key==='Enter'||e.key===' '||e.code==='Space'){
      e.preventDefault();
      touchActivity();
      speak(pickFrom(poolFor('mood:'+mood, moodObj(mood).pool)),{ force:true });
        return;
    }
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown'){
      e.preventDefault();
      touchActivity();
      if(e.key==='ArrowLeft') state.pos.left-=step;
      else if(e.key==='ArrowRight') state.pos.left+=step;
      else if(e.key==='ArrowUp') state.pos.top-=step;
      else state.pos.top+=step;
      clampPos(); saveState();
      return;
    }
    if(isHide){ e.preventDefault(); hide(); }
  }

  // ---------- 上下文（可选后端） ----------
  function bootContext(){
    try{
      fetch('/__mascot/status',{ headers:{ accept:'application/json' } })
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(d){ if(d&&d.activeWorkspace) ctxWorkspace=d.activeWorkspace; })
        .catch(function(){});
    }catch(e){}
  }

  // ---------- 调试钩子 ----------
  window.__dshWhaleGirl={
    version:VER,
    setMood:function(id,opts){ transient=null; sleeping=false; setMood(id,opts||{force:true}); return mood; },
    setState:function(id,opts){ return window.__dshWhaleGirl.setMood(id,opts); },
    speak:function(t,opts){ speak(t||'测试台词',Object.assign({force:true},opts||{})); },
    hide:hide, show:show,
    /** 手动诊断"为什么不动"：应该动却在停时，调一次就能看到卡在哪一步。 */
    motion:function(){
      var v=video||null;
      var animName='';
      try{ animName=getComputedStyle(anim).animationName; }catch(e){}
      return {
        shouldMove: desiredVisual().kind==='video',
        visible: lastVisualKey,
        video: v?{ ok:videoOk, usable:videoUsable(), paused:v.paused, hidden:v.classList.contains('dgw-off'),
                   currentTime:Math.round(v.currentTime*100)/100, readyState:v.readyState,
                   error:v.error?v.error.code:null, retries:videoRetries } : null,
        cssAnimation: animName,
        reducedMotion: reduced, sleeping: sleeping, mood: mood, sensorMood: sensorMood,
        transient: transient?transient.mood:null, errorKey: errorKey, idleMotion: state.idleMotion,
        hidden: isHidden(),
        micro: { last: lastMicroId, scheduled: microTimer!==null },
        sense: { source: bridgeFresh()?'bridge':(sensorMood?'dom':'none'), phase: bridgePhase, tool: bridgeTool,
                 bridgeOk: bridgeOk, fresh: bridgeFresh(), dom: sensorMood, seq: bridgeSeq },
        hoverScale: Math.round(hoverScaleCur*1000)/1000, dragTiltDeg: Math.round(dragTilt*100)/100,
        speedLook: speedLook,
        dialogue: { streaks: streaks, lastKind: lastStreakKind, recent: recentPool.length },
        a11y: { keyboard: !(CFG.a11y&&CFG.a11y.keyboard===false), still: !!state.still },
        act: { id: actCurrent?actCurrent.id:null, sustain: actCurrent?!!actCurrent.sustain:false, frame: actFrameFile||null, edgeDwellMs: edgeSince?now()-edgeSince:0, edgeArmed: !!edgeArmedSide, remaining: actCurrent?Math.max(0, actUntil-now()):0, edge: (function(){ var s=edgeState(); return { side:s.side, bottom:s.bottom }; })() },
        eye: (actCurrent&&actCurrent.eyeLife)?{ base: actCurrent.eyeLife.base, blinkFile: actCurrent.eyeLife.blink||null, blinking: eyeBlinkOn, nextInMs: eyeBlinkOn?0:Math.max(0, Math.round(eyeNextBlinkAt-now())), resting: !!(actCurrent.frames&&actFrameIdx===(actCurrent.frames.length-1)) }:null,
        gaze: { yaw: Math.round(gaze.yaw*100)/100, pitch: Math.round(gaze.pitch*100)/100, enabled: !((CFG.gaze||{}).enabled===false) && !!state.followCursor && !reduced && !state.still },
        i18n: { mode: state.lang, lang: effectiveLang(), packs: Object.keys(LOCALES), detected: detectedLang() },
        tilt: { drag: Math.round(dragTilt*100)/100, edge: edgeTilt },
        startle: { last: startleAt?new Date(startleAt).toISOString():null }
      };
    },
    /** 收摊：清掉定时器/观察者/监听并移除节点（重复注入时新实例会先调它）。 */
    _teardown:teardown,
    /** 强制把"该动的"拉回运动状态（唤醒 + 恢复播放 + 重同步）。 */
    nudge:function(){ ensureMotion(); return window.__dshWhaleGirl.motion(); },
    moods:function(){ return MOOD_IDS.slice(); },
    /** 手动触发休闲动作（测试/排查用）：act('jog')。 */
    act:function(id){ return id===undefined ? (actCurrent?actCurrent.id:null) : startAct(id); },
    stopAct:function(){ stopAct(true); },
    /** 让她立刻眨一次眼（只在贴边保持态里有效）——调试/验收用。 */
    blink:function(){ return blinkNow(); },
    /** 台词覆写：查看 / 设置 / 重置（面板里改的就是这份数据）。 */
    dialogue:function(key,lines){
      if(key===undefined) return { overrides: dialogueOverrides, pools: dialoguePoolList().map(function(x){ return x[0]; }) };
      if(lines===undefined) return dialogueText(key);
      var clean=lines===null?null:sanitizeLines(Array.isArray(lines)?lines:String(lines).split(NL));
      if(clean) dialogueOverrides[key]=clean; else delete dialogueOverrides[key];
      saveDialogueOverrides();
      return dialogueOverrides[key]||null;
    },
    dump:function(){
      return { mood:mood, sensorMood:sensorMood, transient:transient, sleeping:sleeping,
        state:state, visual:lastVisualKey, motion:window.__dshWhaleGirl.motion(), workspace:ctxWorkspace };
    },
    fx:fx, preload:preload
  };

  // ---------- 启动 ----------
  function boot(){
    if(!document.body){ document.addEventListener('DOMContentLoaded',boot); return; }
    loadDialogueOverrides();   // 台词本地覆写：先读，再建 DOM
    // 若上一次注入的实例还在（tapIndex 重复注册 / 热重载），先让它彻底收摊：
    // 否则两套定时器与观察者会互相打架，表现为"忽动忽不动"。
    var prev=window.__dshWhaleGirl;
    if(prev&&typeof prev._teardown==='function'){ try{ prev._teardown(); }catch(e){} }
    dedupeStyles();
    build();
    bootContext();
  }
  boot();
})();
<\/script>
`
