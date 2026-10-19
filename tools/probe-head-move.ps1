# probe-head-move.ps1 — 量"头部位移"与整体尺度：用于验收序列帧的动作幅度
# 做法：先算前景包围盒；再在包围盒上部 35% 区域内算头部质心（headCx）与头部包围盒
param(
  [string]$Dir = 'D:\dsh-code\source\act-peek',
  [int]$MinCh = 232, [int]$MaxDiff = 12,
  [double]$HeadTopFrac = 0.0, [double]$HeadBottomFrac = 0.35
)
Add-Type -AssemblyName System.Drawing
function Bg([System.Drawing.Color]$c) {
  $mn = [Math]::Min($c.R, [Math]::Min($c.G, $c.B)); $mx = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
  return ($mn -ge $MinCh) -and (($mx - $mn) -le $MaxDiff)
}
$rows = @()
foreach ($f in (Get-ChildItem (Join-Path $Dir '*.png') | Where-Object { $_.Name -notlike '_*' } | Sort-Object Name)) {
  $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
  $W = $bmp.Width; $H = $bmp.Height
  $minX = $W; $maxX = -1; $minY = $H; $maxY = -1
  for ($y = 0; $y -lt $H; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      if (Bg $bmp.GetPixel($x, $y)) { continue }
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
  $fh = $maxY - $minY + 1
  $headTop = [int]($minY + $HeadTopFrac * $fh); $headBot = [int]($minY + $HeadBottomFrac * $fh)
  $sx = 0.0; $n = 0; $hMinX = $W; $hMaxX = -1; $hMinY = $H; $hMaxY = -1
  for ($y = $headTop; $y -le $headBot; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      if (Bg $bmp.GetPixel($x, $y)) { continue }
      $sx += $x; $n++
      if ($x -lt $hMinX) { $hMinX = $x }; if ($x -gt $hMaxX) { $hMaxX = $x }
      if ($y -lt $hMinY) { $hMinY = $y }; if ($y -gt $hMaxY) { $hMaxY = $y }
    }
  }
  $bmp.Dispose()
  $rows += [pscustomobject]@{
    Name = $f.Name; W = $W; H = $H
    FigMinX = $minX; FigMaxX = $maxX; FigMinY = $minY; FigMaxY = $maxY
    FigW = ($maxX - $minX + 1); FigH = $fh
    HeadCx = [Math]::Round($sx / [Math]::Max(1, $n), 1); HeadMinX = $hMinX; HeadMaxX = $hMaxX
    HeadW = ($hMaxX - $hMinX + 1); HeadTop = $hMinY
  }
}
$rows | ForEach-Object {
  "{0}  {1}x{2}  人物 bbox ({3},{4})-({5},{6}) 尺寸 {7}x{8}  头顶 y={9}  头 bbox x {10}..{11} (宽 {12})  头部质心 x={13}" -f `
    $_.Name, $_.W, $_.H, $_.FigMinX, $_.FigMinY, $_.FigMaxX, $_.FigMaxY, $_.FigW, $_.FigH, $_.HeadTop, $_.HeadMinX, $_.HeadMaxX, $_.HeadW, $_.HeadCx
}
if ($rows.Count -ge 2) {
  $b0 = $rows[0]
  for ($i = 1; $i -lt $rows.Count; $i++) {
    $b = $rows[$i]
    "帧间 {0}->{1}: 头部位移 dx={2}px  人物宽度差 {3}px  人物高度差 {4}px  头顶差 {5}px" -f `
      $b0.Name, $b.Name, ($b.HeadCx - $b0.HeadCx), ($b.FigW - $b0.FigW), ($b.FigH - $b0.FigH), ($b.HeadTop - $b0.HeadTop)
  }
}
