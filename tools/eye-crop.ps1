# eye-crop.ps1 — 把 9 张立绘的"眼睛候选区域"裁出来拼成一张联络表，供目视定位
# 只做分析，不产出正式素材
param(
  [string]$AssetsDir = (Join-Path $PSScriptRoot '..\assets'),
  [int]$X = 70, [int]$Y = 120, [int]$W = 260, [int]$H = 110,
  [string]$Out = (Join-Path $PSScriptRoot '..\docs\eye-contact.png')
)
Add-Type -AssemblyName System.Drawing

$files = (Get-ChildItem (Join-Path $AssetsDir '*.png') | Where-Object { $_.Name -notlike 'talk-*' } | Sort-Object Name | ForEach-Object { $_.Name })
$scale = 2   # 放大 2 倍便于看清
$cellW = $W * $scale; $cellH = $H * $scale
$sheet = New-Object System.Drawing.Bitmap ($cellW * 3 + 40), ($cellH * 3 + 60)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::FromArgb(255, 20, 24, 32))
$g.InterpolationMode = 'NearestNeighbor'
$font = New-Object System.Drawing.Font('Consolas', 11)

for ($i = 0; $i -lt $files.Count; $i++) {
  $path = Join-Path $AssetsDir $files[$i]
  if (-not (Test-Path $path)) { continue }
  $bmp = [System.Drawing.Bitmap]::FromFile($path)
  $col = $i % 3; $row = [int]($i / 3)
  $dx = 10 + $col * ($cellW + 10); $dy = 10 + $row * ($cellH + 10)
  $rect = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
  $dst = New-Object System.Drawing.Rectangle $dx, $dy, $cellW, $cellH
  $g.DrawImage($bmp, $dst, $rect, 'Pixel')
  # 画参考网格：每 20px（画布坐标）一条线，方便读出眼睛的精确坐标
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 220, 120)), 1
  for ($gx = [Math]::Ceiling($X / 20) * 20; $gx -lt $X + $W; $gx += 20) {
    $px = $dx + ($gx - $X) * $scale
    $g.DrawLine($pen, $px, $dy, $px, $dy + $cellH)
    if ($gx % 40 -eq 0) { $g.DrawString("$gx", $font, [System.Drawing.Brushes]::Khaki, $px + 1, $dy + 1) }
  }
  for ($gy = [Math]::Ceiling($Y / 20) * 20; $gy -lt $Y + $H; $gy += 20) {
    $py = $dy + ($gy - $Y) * $scale
    $g.DrawLine($pen, $dx, $py, $dx + $cellW, $py)
    $g.DrawString("$gy", $font, [System.Drawing.Brushes]::Khaki, $dx + 2, $py + 1)
  }
  $g.DrawString($files[$i], $font, [System.Drawing.Brushes]::White, $dx + 2, $dy + $cellH - 16)
  $bmp.Dispose(); $pen.Dispose()
}
$g.Dispose()
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
"联络表已生成：$Out（裁剪区 x=$X y=$Y ${W}x${H}，放大 ${scale}x，网格每 20px=画布坐标）"
