# probe-act-peek.ps1 — 验收 T5「扒墙偷看」素材：背景纯净度、前景包围盒、贴边切割、帧间漂移
# 判定基于流水线真实规则：背景像素 = min(R,G,B) >= 232 且 (max-min) <= 12
param(
  [string]$Dir = 'D:\dsh-code\source\act-peek',
  [int]$MinCh = 232, [int]$MaxDiff = 12
)
Add-Type -AssemblyName System.Drawing

function IsBgPx([System.Drawing.Color]$c) {
  $mn = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
  $mx = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
  return ($mn -ge $MinCh) -and (($mx - $mn) -le $MaxDiff)
}

$files = Get-ChildItem (Join-Path $Dir '*.png') | Where-Object { $_.Name -notlike '_*' } | Sort-Object Name
$boxes = @()
foreach ($f in $files) {
  $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
  $W = $bmp.Width; $H = $bmp.Height

  # 1) 背景纯净度：四条边（外扩 3 圈）里"不合格背景像素"的比例
  $bad = 0; $tot = 0; $badLeft = 0; $edgeTotLeft = 0
  for ($ring = 0; $ring -lt 3; $ring++) {
    for ($x = 0; $x -lt $W; $x++) {
      foreach ($y in @($ring, ($H - 1 - $ring))) {
        $tot++
        if (-not (IsBgPx $bmp.GetPixel($x, $y))) { $bad++; if ($x -eq $ring) { $badLeft++ } }
        if ($x -eq $ring) { $edgeTotLeft++ }
      }
    }
    for ($y = 0; $y -lt $H; $y++) {
      foreach ($x in @($ring, ($W - 1 - $ring))) {
        $tot++
        if (-not (IsBgPx $bmp.GetPixel($x, $y))) { $bad++; if ($x -eq $ring) { $badLeft++ } }
        if ($x -eq $ring) { $edgeTotLeft++ }
      }
    }
  }

  # 2) 前景包围盒（非背景像素），并统计各边贴边情况
  $minX = $W; $maxX = -1; $minY = $H; $maxY = -1; $fg = 0
  $leftCol = 0; $rightCol = 0; $topRow = 0; $bottomRow = 0
  for ($y = 0; $y -lt $H; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      if (IsBgPx $bmp.GetPixel($x, $y)) { continue }
      $fg++
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      if ($x -eq 0) { $leftCol++ }
      if ($x -eq $W - 1) { $rightCol++ }
      if ($y -eq 0) { $topRow++ }
      if ($y -eq $H - 1) { $bottomRow++ }
    }
  }
  $bmp.Dispose()

  $boxes += [pscustomobject]@{ Name = $f.Name; MinX = $minX; MaxX = $maxX; MinY = $minY; MaxY = $maxY }
  $pct = if ($tot -gt 0) { [Math]::Round(100.0 * $bad / $tot, 2) } else { 0 }
  $pctNoLeft = if (($tot - $edgeTotLeft) -gt 0) { [Math]::Round(100.0 * ($bad - $badLeft) / ($tot - $edgeTotLeft), 2) } else { 0 }
  $badTag = if ($pctNoLeft -le 0.5) { 'OK ' } else { 'BAD' }
  $cutTag = if ($leftCol -gt 20) { '左侧被切(符合预期)' } else { '左侧未切(注意)' }
  "{0}  {1}  边框非背景像素(不含左边缘) {2,6:N2}% [{3}]  前景 {4,7}px  包围盒 ({5},{6})-({7},{8})  {9}  贴边: 左{10} 右{11} 上{12} 下{13}" -f `
    $f.Name, "$W x $H", $pct, $badTag, $fg, $minX, $minY, $maxX, $maxY, $cutTag, $leftCol, $rightCol, $topRow, $bottomRow
}

# 3) 帧间漂移：包围盒的差异
if ($boxes.Count -ge 2) {
  $b0 = $boxes[0]
  foreach ($b in $boxes[1..($boxes.Count - 1)]) {
    "帧间差 {0} vs {1}: dMinX={2} dMaxX={3} dMinY={4} dMaxY={5}  (越小越稳)" -f `
      $b0.Name, $b.Name, ($b.MinX - $b0.MinX), ($b.MaxX - $b0.MaxX), ($b.MinY - $b0.MinY), ($b.MaxY - $b0.MaxY)
  }
}
