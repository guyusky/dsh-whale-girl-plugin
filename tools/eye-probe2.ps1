# eye-probe2.ps1 — 探针二：立绘眼睛里有没有"高光点"，能否稳定检测
# 思路：高光 = 亮度很高、面积小、且被暗像素（瞳孔）包住的连通块。
# 若可行，就能低成本做出"眼神转动"：底图把原高光填成瞳孔色（纯平，易填），再叠一层可位移的高光贴图。
param([string]$AssetsDir = (Join-Path $PSScriptRoot '..\assets'))
Add-Type -AssemblyName System.Drawing
function Get-Lum([System.Drawing.Color]$c) { return 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B }

$files = Get-ChildItem (Join-Path $AssetsDir '*.png') | Where-Object { $_.Name -notlike 'talk-*' }
foreach ($f in $files) {
  $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
  $W = $bmp.Width; $H = $bmp.Height
  $y0 = [int]($H * 0.05); $y1 = [int]($H * 0.55)
  $seen = New-Object 'bool[,]' $W, $H
  $blobs = @()
  for ($y = $y0; $y -lt $y1; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      if ($seen[$x, $y]) { continue }
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -lt 200 -or (Get-Lum $c) -lt 205) { continue }
      # 洪水填充这个亮块
      $stack = New-Object System.Collections.Stack
      $stack.Push(@($x, $y)); $seen[$x, $y] = $true
      $px = 0; $minX = $x; $maxX = $x; $minY = $y; $maxY = $y
      while ($stack.Count -gt 0) {
        $p = $stack.Pop(); $cx = $p[0]; $cy = $p[1]; $px++
        if ($cx -lt $minX) { $minX = $cx }; if ($cx -gt $maxX) { $maxX = $cx }
        if ($cy -lt $minY) { $minY = $cy }; if ($cy -gt $maxY) { $maxY = $cy }
        foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
          $nx = $cx + $d[0]; $ny = $cy + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $W -or $ny -ge $H) { continue }
          if ($seen[$nx, $ny]) { continue }
          $c2 = $bmp.GetPixel($nx, $ny)
          if ($c2.A -lt 200 -or (Get-Lum $c2) -lt 205) { continue }
          $seen[$nx, $ny] = $true; $stack.Push(@($nx, $ny))
        }
      }
      if ($px -ge 3 -and $px -le 400 -and ($maxX - $minX) -le 24 -and ($maxY - $minY) -le 24) { $blobs += , @($px, $minX, $minY, $maxX, $maxY) }
    }
  }
  # 高光必须被暗像素包围（检查紧邻一圈里暗像素占比）
  $kept = @()
  foreach ($b in $blobs) {
    $px = $b[0]; $minX = $b[1]; $minY = $b[2]; $maxX = $b[3]; $maxY = $b[4]
    $dark = 0; $ring = 0
    for ($y = [Math]::Max(0, $minY - 2); $y -le [Math]::Min($H - 1, $maxY + 2); $y++) {
      for ($x = [Math]::Max(0, $minX - 2); $x -le [Math]::Min($W - 1, $maxX + 2); $x++) {
        $inside = ($x -ge $minX -and $x -le $maxX -and $y -ge $minY -and $y -le $maxY)
        if ($inside) { continue }
        $c = $bmp.GetPixel($x, $y); $ring++
        if ($c.A -ge 200 -and (Get-Lum $c) -lt 110) { $dark++ }
      }
    }
    if ($ring -gt 0 -and ($dark / $ring) -ge 0.55) { $kept += , @($px, $minX, $minY, $maxX, $maxY) }
  }
  $bmp.Dispose()
  $desc = ($kept | ForEach-Object { "{0}px@({1},{2})" -f $_[0], $_[1], $_[2] }) -join ' '
  "{0,-16} 亮块 {1,3} 个 → 高光候选 {2,2} 个  {3}" -f $f.Name, $blobs.Count, $kept.Count, $desc
}
