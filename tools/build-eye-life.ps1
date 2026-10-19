# build-eye-life.ps1 — 给"扒墙偷看"的保持态补一张"眨眼帧"（让眼睛像待机那样会动）
#
# 背景（为什么要这张图）：
#   贴到屏幕左右边缘后，引擎把画面切成 act-peek-01/02/03 三帧静态素材。三帧播完停在
#   act-peek-03.png 上"一直保持"，于是眼睛是一张死图 —— 待机态用的是 idle.webm 视频，
#   眼珠逐帧在动，所以贴边时看起来"眼睛不动"。
#   本脚本从 act-peek-03.png 生成同画布、同对齐的"闭眼帧"：
#     ① 用眼睛四周的肤色把眼白/虹膜/睫毛一起填平（保护头发：头发是"高亮+高饱和的浅蓝"，
#        逐像素判掉，所以椭圆框略微压到头发也不会把头发擦掉）；
#     ② 按 assets/sleep.png 里"闭眼"的画法补一条中间粗、两端收尖的下弯眼线。
#   引擎在保持态里每隔几秒把画面换成这一帧 ~130ms，就是一次真眨眼。
#
# 为什么用"离线生成一张完整帧"而不是运行期图层：
#   ① 与现有帧序列共用同一套加载/缓存/切换路径（零新 DOM、零新 CSS、不可能错位）；
#   ② 素材层做像素手术，可以目视验收（docs/eye-life-preview.png），运行期只剩"换 src"。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-eye-life.ps1
#   powershell ... -File tools\build-eye-life.ps1 -Frame act-peek-03.png -DryRun
param(
  [string]$PluginDir = '',
  [string]$Frame = 'act-peek-03.png',        # 源帧（保持态停住的那一帧）
  [string]$Out = 'act-peek-03-blink.png',    # 产物（放 assets/）
  [string]$PreviewName = 'eye-life-preview.png',  # 目视验收图（放 docs/）
  [int]$Zoom = 3,
  [int]$DisplayH = 200,                      # 插件的真实显示高度（mascot.config.mjs 的 imgHeight）
  [switch]$DryRun,
  [switch]$NoPreview
)
if (-not $PluginDir) { $PluginDir = Split-Path $PSScriptRoot -Parent }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PluginDir 'assets'
$docsDir = Join-Path $PluginDir 'docs'
$srcPath = Join-Path $assetsDir $Frame
if (!(Test-Path $srcPath)) { throw "源帧不存在：$srcPath" }

# ---- 眼睛区域（画布坐标 384x512）----
# CX/CY = 眼睛开口中心，RX/RY = 椭圆半径（要盖住眼白+虹膜+上下睫毛；略微压到头发没关系，
# 头发有单独的像素保护）。ROT = 眼睛长轴相对水平的倾角（度，图像坐标：正 = 顺时针/右高左低）。
# 这张图是 3/4 侧脸 + 头是歪的，两只眼睛的长轴都朝右上斜（实测睫毛弦 ≈ -17°），
# **闭眼眼线必须跟着斜**，否则眨眼那一瞬间会看到她"平着闭眼"，非常出戏。
# RY 要按"睫毛上沿到卧蚕"的整段高度取（实测眼睛在本地 v 方向跨 [-22,+16]），所以椭圆中心
# 要比几何中心略高、RY 给到 19~20，否则睫毛上沿那一条会留在画面上，眨眼时看着像"两道线"。
$eyes = @(
  [pscustomobject]@{ Name = 'L'; CX = 86;  CY = 168; RX = 23; RY = 19; Rot = -17 },
  [pscustomobject]@{ Name = 'R'; CX = 146; CY = 142; RX = 27; RY = 20; Rot = -17 }
)
$lidColor = [System.Drawing.Color]::FromArgb(255, 26, 28, 44)   # 眼线色：取自素材睫毛的深色
$lidThick = 3.4                                                 # 眼线最粗处（px）
$lidSag = 0.22                                                  # 眼线中段下弯程度（× RY）
$lidEndLift = 0.18                                              # 两端上抬程度（× RY）

function Get-Lum($c) { return 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B }
function Get-Sat($c) {
  $mx = [Math]::Max($c.R, [Math]::Max($c.G, $c.B)); $mn = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
  if ($mx -eq 0) { return 0.0 }
  return ($mx - $mn) / [double]$mx
}
# 肤色像素：亮、低饱和、而且**偏暖**（R 比 B 高）。最后一条很关键——眼白/高光是纯白或淡青
# （R≈B 或 B>R），不满足"偏暖"就会被排除，不会被当成肤色参考去填眼睛。
function Test-Skin($c) {
  if ($c.A -lt 128) { return $false }
  $l = Get-Lum $c; $s = Get-Sat $c
  return ($l -ge 160) -and ($s -le 0.20) -and (($c.R - $c.B) -ge 8)
}
# 头发像素：浅蓝、亮、饱和（实测头发 lum 166~201 / sat 0.37~0.50 / B-R 93~126；
# 虹膜是深蓝 lum<160，用亮度就能把两者分开）。填平时跳过这些像素。
function Test-Hair($c) {
  if ($c.A -lt 128) { return $false }
  $l = Get-Lum $c; $s = Get-Sat $c
  return ($s -ge 0.30) -and ($l -ge 155) -and (($c.B - $c.R) -ge 70)
}

Write-Host "源帧   : $Frame"
Write-Host "产物   : $Out"

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$canvasW = $src.Width; $canvasH = $src.Height
$dst = New-Object System.Drawing.Bitmap $canvasW, $canvasH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.DrawImage($src, 0, 0, $canvasW, $canvasH)
$g.Dispose()

foreach ($eye in $eyes) {
  $cx = $eye.CX; $cy = $eye.CY; $rx = $eye.RX; $ry = $eye.RY
  $th = $eye.Rot * [Math]::PI / 180.0
  $ct = [Math]::Cos($th); $st = [Math]::Sin($th)
  # 眼睛是斜的：所有几何都在"眼睛本地坐标系"里算（u 沿长轴、v 垂直于长轴），再旋回画面。
  # 本地→画面： x = cx + u*ct - v*st ; y = cy + u*st + v*ct
  function ToScreenU($u, $v) { return @(($cx + $u * $ct - $v * $st), ($cy + $u * $st + $v * $ct)) }
  # 给定画面列 x，求旋转椭圆在该列的 dy 范围（解 A*dy^2 + B*dy + C <= 0）
  function YRange($x) {
    $dx = $x - $cx
    $A = $st * $st / ($rx * $rx) + $ct * $ct / ($ry * $ry)
    $B = 2 * $dx * $ct * $st * (1.0 / ($rx * $rx) - 1.0 / ($ry * $ry))
    $C = $dx * $dx * ($ct * $ct / ($rx * $rx) + $st * $st / ($ry * $ry)) - 1.0
    $D = $B * $B - 4 * $A * $C
    if ($D -lt 0) { return $null }
    $s = [Math]::Sqrt($D)
    $lo = (-$B - $s) / (2 * $A)
    $hi = (-$B + $s) / (2 * $A)
    return @($lo, $hi)
  }

  # ---- 1) 逐列取色：从眼睛上方的"眼睑肤色"往下抹 ----
  # 闭眼在视觉上就是"上眼睑盖下来"，所以填充色直接取**眼睛正上方最近的那块真肤色**：
  # 每一列从眼睛上缘往上找第一个肤色像素，找到就用它的颜色填这一列。肤色只从原图取，
  # 不凭空造；找不到（被头发挡住）就退到眼睛下方，再退到相邻列。
  # 列范围要按"旋转后的外接框"取，否则斜着的眼睛两端会被切掉。
  $axE = [int][Math]::Ceiling([Math]::Sqrt($rx * $rx * $ct * $ct + $ry * $ry * $st * $st)) + 2
  $ayE = [int][Math]::Ceiling([Math]::Sqrt($rx * $rx * $st * $st + $ry * $ry * $ct * $ct)) + 2
  $colW = $axE
  $cols = @{}
  for ($x = $cx - $colW; $x -le $cx + $colW; $x++) {
    $rng = YRange $x
    $found = $null; $sumR = 0; $sumG = 0; $sumB = 0; $n = 0
    if ($null -ne $rng) {
      $edgeTop = [int][Math]::Round($cy + $rng[0]); $edgeBottom = [int][Math]::Round($cy + $rng[1])
      for ($d = 2; $d -le 14; $d++) {
        $y = $edgeTop - $d
        if ($y -lt 0) { break }
        $c = $src.GetPixel($x, $y)
        if (Test-Skin $c) { $sumR += $c.R; $sumG += $c.G; $sumB += $c.B; $n++ }
        elseif ($n -gt 0) { break }                   # 取到肤色后遇到杂物就停，避免把刘海算进来
      }
      if ($n -gt 0) { $found = [System.Drawing.Color]::FromArgb(255, [int]($sumR / $n), [int]($sumG / $n), [int]($sumB / $n)) }
      if ($null -eq $found) {
        $sumR = 0; $sumG = 0; $sumB = 0; $n = 0
        for ($d = 2; $d -le 14; $d++) {
          $y = $edgeBottom + $d
          if ($y -ge $canvasH) { break }
          $c = $src.GetPixel($x, $y)
          if (Test-Skin $c) { $sumR += $c.R; $sumG += $c.G; $sumB += $c.B; $n++ }
          elseif ($n -gt 0) { break }
        }
        if ($n -gt 0) { $found = [System.Drawing.Color]::FromArgb(255, [int]($sumR / $n), [int]($sumG / $n), [int]($sumB / $n)) }
      }
    }
    $cols[$x] = $found
  }
  # 缺色的列用左右邻居补，再做一次 5 抽头平滑（把竖条纹抹平）
  for ($x = $cx - $colW; $x -le $cx + $colW; $x++) {
    if ($null -ne $cols[$x]) { continue }
    foreach ($step in @(-1, 1, -2, 2, -3, 3, -4, 4)) {
      $n2 = $x + $step
      if ($cols.ContainsKey($n2) -and $null -ne $cols[$n2]) { $cols[$x] = $cols[$n2]; break }
    }
    if ($null -eq $cols[$x]) { $cols[$x] = [System.Drawing.Color]::FromArgb(255, 255, 236, 229) }
  }
  $smooth = @{}
  for ($x = $cx - $colW; $x -le $cx + $colW; $x++) {
    $sumR = 0; $sumG = 0; $sumB = 0; $n = 0
    for ($k = -4; $k -le 4; $k++) {
      $c = $cols[$x + $k]; if ($null -eq $c) { continue }
      $w = 5 - [Math]::Abs($k)
      $sumR += $c.R * $w; $sumG += $c.G * $w; $sumB += $c.B * $w; $n += $w
    }
    if ($n -eq 0) { $c = $cols[$x]; $sumR = $c.R * 9; $sumG = $c.G * 9; $sumB = $c.B * 9; $n = 9 }
    $smooth[$x] = [System.Drawing.Color]::FromArgb(255,
      [int][Math]::Round($sumR / $n), [int][Math]::Round($sumG / $n), [int][Math]::Round($sumB / $n))
  }

  # ---- 2) 把旋转椭圆（略放大）盖成肤色 ----
  # 椭圆判定用本地坐标（u,v）：u 沿眼睛长轴、v 垂直于它，所以斜着的眼睛也能贴住。
  # 半径放大 1.5px：眼睛轮廓的抗锯齿边也要盖住，否则会留一圈灰晕。
  # 外圈（半径 1.0~1.35）只擦"眼睛像素"（深色睫毛、深蓝虹膜、纯白眼白）——
  # 斜着眼睛的睫毛两端往往正好压在椭圆边上，不擦就会留一道"双线"。
  $filled = 0
  $rxE = $rx + 1.5; $ryE = $ry + 1.5
  $ringX = [int][Math]::Ceiling([Math]::Sqrt($rxE * $rxE * $ct * $ct + $ryE * $ryE * $st * $st) * 1.35) + 2
  $ringY = [int][Math]::Ceiling([Math]::Sqrt($rxE * $rxE * $st * $st + $ryE * $ryE * $ct * $ct) * 1.35) + 2
  for ($y = [Math]::Max(0, $cy - $ringY); $y -le [Math]::Min($canvasH - 1, $cy + $ringY); $y++) {
    for ($x = [Math]::Max(0, $cx - $ringX); $x -le [Math]::Min($canvasW - 1, $cx + $ringX); $x++) {
      $dx = $x - $cx; $dy = $y - $cy
      $u = $dx * $ct + $dy * $st
      $v = -$dx * $st + $dy * $ct
      $rr = ($u * $u) / ($rxE * $rxE) + ($v * $v) / ($ryE * $ryE)
      if ($rr -gt 1.35) { continue }
      $orig = $src.GetPixel($x, $y)
      if ($orig.A -lt 8) { continue }
      if (Test-Hair $orig) { continue }             # 头发不擦
      if ($rr -gt 1.0) {
        $l = Get-Lum $orig; $s = Get-Sat $orig
        $isEye = ($l -le 125) -or ($l -ge 235 -and $s -le 0.12)
        if (-not $isEye) { continue }
      }
      $col = $smooth[$x]; if ($null -eq $col) { $col = $smooth[$cx] }
      $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $col.R, $col.G, $col.B))
      $filled++
    }
  }

  # ---- 3) 补一条"闭合的眼线"：中间粗两端收尖的浅下弯（画法参考 assets/sleep.png）----
  # 同样在本地坐标里画，再把控制点旋转到画面 —— 眼线因此和眼睛的倾斜、透视一致。
  # 先画到独立图层再合成：**原图这里是头发的像素就别画**，否则眼线会顺着眼角爬到发丝上。
  $lidLayer = New-Object System.Drawing.Bitmap $canvasW, $canvasH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = [System.Drawing.Graphics]::FromImage($lidLayer)
  $g2.SmoothingMode = 'AntiAlias'
  $g2.Clear([System.Drawing.Color]::Transparent)
  $u0 = -$rx * 0.94; $u1 = $rx * 0.94
  $vEnd = -$ry * $lidEndLift               # 两端位置（略高于中心）
  $vMid = $ry * $lidSag                    # 中间下弯到哪
  $vCtrl = ($vMid + $vEnd) / 2
  $p0 = ToScreenU $u0 $vEnd
  $p1 = ToScreenU $u1 $vEnd
  $c1 = ToScreenU ($u0 * 0.48) $vCtrl
  $c2 = ToScreenU ($u1 * 0.48) $vCtrl
  $c1b = ToScreenU ($u0 * 0.48) ($vCtrl - $lidThick)
  $c2b = ToScreenU ($u1 * 0.48) ($vCtrl - $lidThick)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddBezier(
    (New-Object System.Drawing.PointF $p0[0], $p0[1]),
    (New-Object System.Drawing.PointF $c1[0], $c1[1]),
    (New-Object System.Drawing.PointF $c2[0], $c2[1]),
    (New-Object System.Drawing.PointF $p1[0], $p1[1]))
  $path.AddBezier(
    (New-Object System.Drawing.PointF $p1[0], $p1[1]),
    (New-Object System.Drawing.PointF $c2b[0], $c2b[1]),
    (New-Object System.Drawing.PointF $c1b[0], $c1b[1]),
    (New-Object System.Drawing.PointF $p0[0], $p0[1]))
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush $lidColor
  $g2.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose(); $g2.Dispose()

  # 合成：按图层 alpha 混合；原图是头发的地方跳过
  $lidPainted = 0
  for ($y = [Math]::Max(0, [int][Math]::Floor([Math]::Min($p0[1], $p1[1]) - 6)); $y -le [Math]::Min($canvasH - 1, [int][Math]::Ceiling([Math]::Max($p0[1], $p1[1]) + 6)); $y++) {
    for ($x = [Math]::Max(0, [int][Math]::Floor([Math]::Min($p0[0], $p1[0]))); $x -le [Math]::Min($canvasW - 1, [int][Math]::Ceiling([Math]::Max($p0[0], $p1[0]))); $x++) {
      $lc = $lidLayer.GetPixel($x, $y)
      if ($lc.A -lt 8) { continue }
      if (Test-Hair ($src.GetPixel($x, $y))) { continue }   # 眼线不爬到头发上
      $a = $lc.A / 255.0
      $d = $dst.GetPixel($x, $y)
      $nr = [int][Math]::Round($d.R * (1 - $a) + $lc.R * $a)
      $ng = [int][Math]::Round($d.G * (1 - $a) + $lc.G * $a)
      $nb = [int][Math]::Round($d.B * (1 - $a) + $lc.B * $a)
      $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $nr, $ng, $nb))
      $lidPainted++
    }
  }
  $lidLayer.Dispose()
  Write-Host ("  眼 {0}: 中心({1},{2}) 半径({3},{4}) 倾角 {5}°  填平 {6} px  眼线 {7} px ({8:N0},{9:N0})→({10:N0},{11:N0})" -f `
      $eye.Name, $cx, $cy, $rx, $ry, $eye.Rot, $filled, $lidPainted, $p0[0], $p0[1], $p1[0], $p1[1])
}

$dstPath = Join-Path $assetsDir $Out
if (-not $DryRun) {
  $dst.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("  写出 {0}  {1:N0} B" -f $Out, (Get-Item $dstPath).Length)
}

# ---- 4) 目视验收图：原图（带填平范围示意）与闭眼帧并排放大 ----
if (-not $NoPreview -and -not $DryRun) {
  $src2 = [System.Drawing.Bitmap]::FromFile($srcPath)
  $cx0 = 45; $cy0 = 100; $cw = 155; $ch = 110
  $cellW = $cw * $Zoom; $cellH = $ch * $Zoom
  $sheet = New-Object System.Drawing.Bitmap ($cellW * 2 + 30), ($cellH + 34)
  $sg = [System.Drawing.Graphics]::FromImage($sheet)
  $sg.Clear([System.Drawing.Color]::FromArgb(255, 22, 26, 34))
  $sg.InterpolationMode = 'NearestNeighbor'
  $font = New-Object System.Drawing.Font('Consolas', 11)
  $rect = New-Object System.Drawing.Rectangle $cx0, $cy0, $cw, $ch
  $sg.DrawImage($src2, (New-Object System.Drawing.Rectangle 10, 26, $cellW, $cellH), $rect, 'Pixel')
  $sg.DrawImage($dst, (New-Object System.Drawing.Rectangle (20 + $cellW), 26, $cellW, $cellH), $rect, 'Pixel')
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(130, 255, 90, 90)), 1
  $sg.SmoothingMode = 'AntiAlias'
  foreach ($eye in $eyes) {
    foreach ($ox in @(10, 20 + $cellW)) {
      # 画"旋转后的椭圆"，这样原图panel里能直接看出填平范围有没有贴住斜着的眼睛
      $ecx = $ox + ($eye.CX - $cx0) * $Zoom
      $ecy = 26 + ($eye.CY - $cy0) * $Zoom
      $rw = $eye.RX * 2 * $Zoom; $rh = $eye.RY * 2 * $Zoom
      $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
      $gp.AddEllipse(($ecx - $rw / 2), ($ecy - $rh / 2), $rw, $rh)
      $mp = New-Object System.Drawing.Drawing2D.Matrix
      $mp.RotateAt($eye.Rot, (New-Object System.Drawing.PointF $ecx, $ecy))
      $gp.Transform($mp)
      $sg.DrawPath($pen, $gp)
      $gp.Dispose(); $mp.Dispose()
    }
  }
  $sg.SmoothingMode = 'None'
  $pen.Dispose()
  $sg.DrawString("$Frame (open, red = fill area)", $font, [System.Drawing.Brushes]::White, 10, 6)
  $sg.DrawString("$Out (blink)", $font, [System.Drawing.Brushes]::Khaki, 20 + $cellW, 6)
  $sg.Dispose(); $src2.Dispose()
  New-Item -ItemType Directory -Force -Path $docsDir | Out-Null
  $prevPath = Join-Path $docsDir $PreviewName
  $sheet.Save($prevPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "  验收图 $prevPath"
  $sheet.Dispose()

  # ---- 5) 真实显示尺寸验收图 ----
  # 插件里她只有 200px 高（mascot.config.mjs 的 imgHeight），所以真正要看的不是 3 倍放大的
  # 细节，而是"按真实像素密度看像不像". 这里按真实尺寸画一遍再放大 4 倍（NearestNeighbor），
  # 放大后看到的颗粒感 = 真机上她脸上的像素密度。
  $src3 = [System.Drawing.Bitmap]::FromFile($srcPath)
  $dispW = [int][Math]::Round($DisplayH * 0.75); $dispH = $DisplayH; $dz = 4
  $sheet2 = New-Object System.Drawing.Bitmap (($dispW * $dz + 10) * 2 + 20), ($dispH * $dz + 34)
  $sg2 = [System.Drawing.Graphics]::FromImage($sheet2)
  $sg2.Clear([System.Drawing.Color]::FromArgb(255, 22, 26, 34))
  $sg2.InterpolationMode = 'HighQualityBicubic'
  $sg2.PixelOffsetMode = 'HighQuality'
  foreach ($pair in @(@($src3, 0), @($dst, 1))) {
    $small = New-Object System.Drawing.Bitmap $dispW, $dispH
    $gs = [System.Drawing.Graphics]::FromImage($small)
    $gs.InterpolationMode = 'HighQualityBicubic'; $gs.PixelOffsetMode = 'HighQuality'
    $gs.DrawImage($pair[0], 0, 0, $dispW, $dispH); $gs.Dispose()
    $dx = 10 + $pair[1] * ($dispW * $dz + 20)
    $sg2.DrawImage($small, (New-Object System.Drawing.Rectangle $dx, 26, ($dispW * $dz), ($dispH * $dz)))
    $small.Dispose()
  }
  $sg2.DrawString("real size ${dispW}x${dispH} (open)", $font, [System.Drawing.Brushes]::White, 10, 6)
  $sg2.DrawString("real size ${dispW}x${dispH} (blink)", $font, [System.Drawing.Brushes]::Khaki, (10 + $dispW * $dz + 20), 6)
  $sg2.Dispose(); $src3.Dispose()
  $rsPath = Join-Path $docsDir 'eye-life-realsize.png'
  $sheet2.Save($rsPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "  真实尺寸验收图 $rsPath"
  $sheet2.Dispose()
}
$src.Dispose(); $dst.Dispose()
if ($DryRun) { Write-Host '（DryRun：没有写文件）' }
Write-Host '完成。'
