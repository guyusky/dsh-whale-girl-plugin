# eye-probe.ps1 — 素材探针：看这 9 张立绘能不能拆出"眼睛"和"头部"图层
# 输出：每张图的暗像素（眼睛/描边）分布、左右眼包围盒、眼眶周围颜色平整度、颈部收窄位置
# 只做分析，不产出素材（产出在 build-assets.ps1 里做）
param(
  [string]$AssetsDir = (Join-Path $PSScriptRoot '..\assets')
)
Add-Type -AssemblyName System.Drawing

function Get-Lum([System.Drawing.Color]$c) { return 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B }

$files = Get-ChildItem (Join-Path $AssetsDir '*.png') | Where-Object { $_.Name -notlike 'talk-*' }
foreach ($f in $files) {
  $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
  $W = $bmp.Width; $H = $bmp.Height
  $headTop = [int]($H * 0.06); $headBottom = [int]($H * 0.52)

  # 暗像素（alpha 有效且亮度低）：眼睛本体、睫毛、描边都在这类里
  $minX = $W; $maxX = -1; $minY = $H; $maxY = -1; $count = 0
  $colCount = New-Object 'int[]' $W
  for ($y = $headTop; $y -lt $headBottom; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -lt 128) { continue }
      if ((Get-Lum $c) -gt 90) { continue }
      $count++
      $colCount[$x]++
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }

  # 用列直方图找"两眼的水平间隙"：把暗像素列分成左右两簇
  $gapX = -1; $best = 0
  if ($maxX -gt $minX) {
    for ($x = $minX; $x -le $maxX; $x++) {
      if ($colCount[$x] -eq 0) { continue }
      $run = 0; $xx = $x
      while ($xx -le $maxX -and $colCount[$xx] -eq 0) { $run++; $xx++ }
      if ($run -gt $best) { $best = $run; $gapX = $x }
    }
  }

  # 眼眶周围颜色（采样包围盒外扩 5px 的环带）→ 判断"能否用底色填掉眼睛"
  $sumR = 0.0; $sumG = 0.0; $sumB = 0.0; $n = 0; $dev = 0.0
  $pad = 5
  for ($y = [Math]::Max(0, $minY - $pad); $y -le [Math]::Min($H - 1, $maxY + $pad); $y++) {
    for ($x = [Math]::Max(0, $minX - $pad); $x -le [Math]::Min($W - 1, $maxX + $pad); $x++) {
      $inside = ($x -ge $minX -and $x -le $maxX -and $y -ge $minY -and $y -le $maxY)
      if ($inside) { continue }
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -lt 200) { continue }
      $sumR += $c.R; $sumG += $c.G; $sumB += $c.B; $n++
    }
  }
  # 再算一次标准差（平整度）
  if ($n -gt 0) {
    $mR = $sumR / $n; $mG = $sumG / $n; $mB = $sumB / $n
    for ($y = [Math]::Max(0, $minY - $pad); $y -le [Math]::Min($H - 1, $maxY + $pad); $y++) {
      for ($x = [Math]::Max(0, $minX - $pad); $x -le [Math]::Min($W - 1, $maxX + $pad); $x++) {
        $inside = ($x -ge $minX -and $x -le $maxX -and $y -ge $minY -and $y -le $maxY)
        if ($inside) { continue }
        $c = $bmp.GetPixel($x, $y)
        if ($c.A -lt 200) { continue }
        $dev += [Math]::Abs($c.R - $mR) + [Math]::Abs($c.G - $mG) + [Math]::Abs($c.B - $mB)
      }
    }
    $dev = $dev / ($n * 3)
  }

  # 每行的前景宽度 → 找"颈部最窄处"（头部图层切在这里，缝隙最容易被身体盖住）
  $narrowY = -1; $narrowW = [int]::MaxValue
  for ($y = [int]($H * 0.40); $y -lt [int]($H * 0.62); $y++) {
    $w = 0
    for ($x = 0; $x -lt $W; $x++) { if ($bmp.GetPixel($x, $y).A -ge 128) { $w++ } }
    if ($w -gt 0 -and $w -lt $narrowW) { $narrowW = $w; $narrowY = $y }
  }
  $bmp.Dispose()

  $eyeBox = if ($maxX -ge 0) { "($minX,$minY)-($maxX,$maxY) ${W}x${H}" } else { '未找到' }
  $eyeW = if ($maxX -ge 0) { $maxX - $minX + 1 } else { 0 }
  $eyeH = if ($maxY -ge 0) { $maxY - $minY + 1 } else { 0 }
  "{0,-18} 暗像素 {1,6}  眼部包围盒 {2,-26} 眼区 {3}x{4}  双眼间隙 {5}px  眶周色 σ {6:N1}（均值 {7:N0},{8:N0},{9:N0}）  颈部最窄 y={10} w={11}" -f `
    $f.Name, $count, $eyeBox, $eyeW, $eyeH, $best, $dev, ($sumR / [Math]::Max(1, $n)), ($sumG / [Math]::Max(1, $n)), ($sumB / [Math]::Max(1, $n)), $narrowY, $narrowW
}
