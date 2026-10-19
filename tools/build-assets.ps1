# build-assets.ps1 — DeepSeek 鲸鱼娘看板娘 · 素材流水线（可重复执行）
#
# 把 source/ 里的原始素材（棋盘格白底、不透明 PNG + 待机动画 MP4）处理成插件运行期素材：
#   assets/*.png      9 张透明表情立绘：边界泛洪抠图 → 统一基准对齐 → 缩放 → 透明 PNG
#   assets/idle.webm  待机动画：抽帧 → 逐帧抠图 → VP9 alpha WebM
#   docs/preview.png  素材总览图
#   icon.png          插件图标（头像裁切）
# 最后打印角色剪影多边形，粘贴到 mascot.config.mjs 的 hitPolygon（命中区域裁切用）。
#
# 用法（Windows PowerShell 5.1+）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-assets.ps1
#   powershell ... -File tools\build-assets.ps1 -SourceDir D:\dsh-code\source -Video 灵动待机动图.mp4
#
# 依赖：.NET System.Drawing（系统自带）；ffmpeg（见 -Ffmpeg，需带 libvpx-vp9 才能编 alpha WebM）。
# 说明：原始素材是 1344x1792 不透明 PNG（.jpeg 后缀名是错的，实际是 PNG），背景是 248/255 浅色棋盘格，
#       所以必须抠图；所有表情共用同一基准（角色包围盒底边中点 + 高度比例）保证切换不跳位。
param(
  [string]$SourceDir = (Join-Path $PSScriptRoot '..\..\source'),
  [string]$PluginDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Video = '灵动待机动图.mp4',
  [string]$Ffmpeg = '',
  [int]$Fps = 15,                 # 待机动画抽帧率（源 24fps，15fps 足够顺滑且体积小）
  [int]$Crf = 34,                 # VP9 质量（越大越小越糊）
  [int]$OutW = 384, [int]$OutH = 512,   # 画布 3:4；默认显示高度 200px，2x DPR 下仍有余量
  [double]$BodyFrac = 0.86,       # 角色身高占画布高度比例（统一所有素材）
  [double]$FootFrac = 0.95,       # 脚底在画布中的 y 比例
  [int]$StillMinCh = 232, [int]$StillDiff = 12,   # 静态图背景判定：最小通道 ≥232 且通道极差 ≤12
  [int]$VidMinCh = 238, [int]$VidDiff = 10,       # 视频帧噪声更小、背景更白
  [switch]$SkipVideo              # 只重建静态表情，不动 idle.webm
)

$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'keytool.cs') -ReferencedAssemblies 'System.Drawing'
Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PluginDir 'assets'
$docsDir = Join-Path $PluginDir 'docs'
$tmpDir = Join-Path $env:TEMP ('dgw-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $assetsDir, $docsDir, $tmpDir | Out-Null

# 原始文件名 → 运行期文件名（character.mjs 引用后者）
# 注意：`主体.jpeg` 的后缀名是错的（内容是 PNG；System.Drawing 按内容识别，能正常读）。
$baseFile = '主体.jpeg'
$map = [ordered]@{
  $baseFile           = 'idle.png'
  '思考.png'          = 'thinking.png'
  '开心.png'          = 'happy.png'
  '难过.png'          = 'sad.png'
  '生气.png'          = 'angry.png'
  '打盹.png'          = 'sleep.png'
  '头晕.png'          = 'dizzy.png'
  '说话(闭着嘴).png'  = 'talk-closed.png'
  '说话(张着嘴).png'  = 'talk-open.png'
}

function Find-Ffmpeg {
  param([string]$Explicit)
  if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }
  # 1) 放在 tools/ 下的自带 ffmpeg（推荐：需要带 libvpx-vp9 才能编 alpha WebM）
  $local = Join-Path $PSScriptRoot 'ffmpeg.exe'
  if (Test-Path $local) { return $local }
  # 2) PATH 里的 ffmpeg
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # 3) 本机已知可用的第三方 ffmpeg（仅作兜底；编码后会解码回验 alpha，失败会明确告警）
  foreach ($p in @('D:\Tool\格式工厂_v5.22.0_去广告绿色版_x64\ffmpeg.exe')) { if (Test-Path $p) { return $p } }
  return ''
}

Write-Host "源目录 : $SourceDir"
Write-Host "输出   : $assetsDir"
if (!(Test-Path $SourceDir)) { throw "源目录不存在：$SourceDir" }
foreach ($src in $map.Keys) {
  if (!(Test-Path (Join-Path $SourceDir $src))) { throw "缺少原始素材：$src（应为 $($map[$src])）" }
}

# ---------- 1) 基准：主体图的前景包围盒（底边中点 = 对齐锚点）----------
$base = [KeyTool]::BoundsOf((Join-Path $SourceDir $baseFile), $StillMinCh, $StillDiff)
$bx = ($base[0] + $base[2]) / 2.0
$by = $base[3]
$scale = ($OutH * $BodyFrac) / ($base[3] - $base[1] + 1)
$ox = $OutW / 2.0
$oy = $OutH * $FootFrac
Write-Host ("基准   : bbox=({0},{1})-({2},{3}) 锚点=({4},{5}) scale={6:N4} 画布={7}x{8}" -f `
  $base[0], $base[1], $base[2], $base[3], $bx, $by, $scale, $OutW, $OutH)

# ---------- 2) 静态表情：抠图 + 对齐 + 缩放 ----------
foreach ($src in $map.Keys) {
  $dst = Join-Path $assetsDir $map[$src]
  # 边缘柔和过渡带：像素亮于 rampHi 视为背景(透明)，暗于 rampLo 视为实体
  [KeyTool]::Render((Join-Path $SourceDir $src), $dst, $scale, $bx, $by, $OutW, $OutH, $ox, $oy,
    $StillMinCh, $StillDiff, $StillMinCh, 252)
  Write-Host ("  表情 {0,-16} -> {1,-16} {2,7:N0} B" -f $src, $map[$src], (Get-Item $dst).Length)
}

# ---------- 3) 待机动画：抽帧 -> 逐帧抠图 -> VP9 alpha WebM ----------
if (!$SkipVideo) {
  $ff = Find-Ffmpeg $Ffmpeg
  if (!$ff) { Write-Warning "未找到 ffmpeg，跳过 idle.webm 重建（静态表情已更新）" }
  else {
    $videoPath = Join-Path $SourceDir $Video
    if (!(Test-Path $videoPath)) { Write-Warning "未找到待机动画源文件 $Video，跳过" }
    else {
      Write-Host "ffmpeg : $ff"
      $frames = Join-Path $tmpDir 'src'
      $keyed = Join-Path $tmpDir 'keyed'
      New-Item -ItemType Directory -Force -Path $frames, $keyed | Out-Null
      & $ff -hide_banner -loglevel error -y -i $videoPath -vf "fps=$Fps" -an (Join-Path $frames 'f%04d.png')
      $frameFiles = Get-ChildItem $frames -Filter *.png | Sort-Object Name
      Write-Host ("  抽帧   : {0} 帧 @ {1}fps" -f $frameFiles.Count, $Fps)

      # 视频与静态图同为 3:4，但像素尺寸不同：按"静态源图宽 / 视频帧宽"换算缩放系数，
      # 使视频里角色的显示高度与静态表情一致，切换不跳位。
      $vidBase = [KeyTool]::BoundsOf($frameFiles[0].FullName, $VidMinCh, $VidDiff)
      $stillImg = [System.Drawing.Image]::FromFile((Join-Path $SourceDir $baseFile))
      $stillW = $stillImg.Width
      $stillImg.Dispose()
      $vidImg = [System.Drawing.Image]::FromFile($frameFiles[0].FullName)
      $vidW = $vidImg.Width
      $vidImg.Dispose()
      $ratio = $vidW / [double]$stillW
      $vbx = ($vidBase[0] + $vidBase[2]) / 2.0
      $vby = $vidBase[3]
      $vscale = $scale / $ratio
      foreach ($f in $frameFiles) {
        [KeyTool]::Render($f.FullName, (Join-Path $keyed $f.Name), $vscale, $vbx, $vby, $OutW, $OutH, $ox, $oy,
          $VidMinCh, $VidDiff, $VidMinCh, 254)
      }
      Write-Host ("  抠帧   : {0} 帧（视频基准 ({1},{2}) scale={3:N3}）" -f $frameFiles.Count, $vbx, $vby, $vscale)

      $webm = Join-Path $assetsDir 'idle.webm'
      & $ff -hide_banner -loglevel error -y -framerate $Fps -i (Join-Path $keyed 'f%04d.png') `
        -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf $Crf -an $webm
      if (Test-Path $webm) {
        # 校验 alpha 真的写进去了（用 libvpx 解码回一帧，看 alpha 包围盒是否小于画布）
        $probe = Join-Path $tmpDir 'probe.png'
        & $ff -hide_banner -loglevel error -y -c:v libvpx-vp9 -i $webm -frames:v 1 $probe
        $ab = [KeyTool]::AlphaBoundsOf($probe)
        $opaque = ($ab[0] -eq 0 -and $ab[1] -eq 0 -and $ab[2] -eq $OutW - 1 -and $ab[3] -eq $OutH - 1)
        if ($opaque) {
          Write-Warning "idle.webm 解码后不含 alpha —— 当前 ffmpeg 可能没编出 alpha 通道（需要带 libvpx-vp9 的新版 ffmpeg）"
        } else {
          Write-Host ("  待机   : idle.webm {0,7:N0} B  alpha bbox=({1},{2})-({3},{4})" -f (Get-Item $webm).Length, $ab[0], $ab[1], $ab[2], $ab[3])
        }
      }
    }
  }
}

# ---------- 5) 图标 + 总览图 ----------
$iconSrc = Join-Path $SourceDir $baseFile
[KeyTool]::Render($iconSrc, (Join-Path $PluginDir 'icon.png'), 0.34, $bx, ($base[1] + 470), 256, 256, 128, 128, $StillMinCh, $StillDiff, $StillMinCh, 252)

$preview = New-Object System.Drawing.Bitmap 1500, 800
$g = [System.Drawing.Graphics]::FromImage($preview)
$g.Clear([System.Drawing.Color]::FromArgb(255, 26, 32, 46))
$g.InterpolationMode = 'HighQualityBicubic'
$font = New-Object System.Drawing.Font('Microsoft YaHei', 15)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 210, 225, 245))
$labels = @('idle 待机', 'thinking 思考', 'happy 完成', 'sleep 打盹', 'angry 生气', 'sad 出错', 'dizzy 头晕', 'talk 说话(闭)', 'talk 说话(张)')
$order = @('idle.png', 'thinking.png', 'happy.png', 'sleep.png', 'angry.png', 'sad.png', 'dizzy.png', 'talk-closed.png', 'talk-open.png')
$tw = 300; $th = 400
for ($i = 0; $i -lt $order.Count; $i++) {
  $x = ($i % 5) * $tw; $y = [math]::Floor($i / 5) * $th
  $im = [System.Drawing.Image]::FromFile((Join-Path $assetsDir $order[$i]))
  $g.DrawImage($im, $x + 10, $y + 10, $tw - 20, $th - 50)
  $im.Dispose()
  $g.DrawString($labels[$i], $font, $brush, $x + 12, $y + $th - 32)
}
$g.Dispose()
$preview.Save((Join-Path $docsDir 'preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()

# ---------- 6) 命中区域剪影（粘贴到 mascot.config.mjs）----------
$poly = [KeyTool]::Silhouette((Join-Path $assetsDir 'idle.png'), 28, 14, 1.05)
Write-Host ''
Write-Host '把下面一行粘到 mascot.config.mjs 的 hitPolygon（角色剪影，透明留白不吃鼠标事件）：'
Write-Host ("hitPolygon: '{0}'," -f $poly)

# ---------- 7) 收尾 ----------
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
$sum = (Get-ChildItem $assetsDir | Measure-Object Length -Sum).Sum
Write-Host ''
Write-Host ("完成：assets/ 共 {0} 个文件 {1:N2} MB" -f (Get-ChildItem $assetsDir).Count, ($sum / 1MB))
Get-ChildItem $assetsDir | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-18} {1,8:N0} B" -f $_.Name, $_.Length) }
