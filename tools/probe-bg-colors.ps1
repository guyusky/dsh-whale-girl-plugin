# probe-bg-colors.ps1 — 诊断背景色：为什么边框有 3% 像素不满足"纯白"判定
param(
  [string]$File = 'D:\dsh-code\source\act-peek\01.png',
  [int]$MinCh = 232, [int]$MaxDiff = 12
)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile($File)
$W = $bmp.Width; $H = $bmp.Height

function Ok([System.Drawing.Color]$c) {
  $mn = [Math]::Min($c.R, [Math]::Min($c.G, $c.B)); $mx = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
  return ($mn -ge $MinCh) -and (($mx - $mn) -le $MaxDiff)
}

$hist = @{}
$badByEdge = @{ top = 0; bottom = 0; left = 0; right = 0 }
$badRows = @{}
for ($ring = 0; $ring -lt 3; $ring++) {
  for ($x = 0; $x -lt $W; $x++) {
    foreach ($y in @($ring, ($H - 1 - $ring))) {
      $c = $bmp.GetPixel($x, $y)
      if (-not (Ok $c)) {
        $k = "$($c.R),$($c.G),$($c.B)"
        $hist[$k] = 1 + $hist[$k]
        if ($y -eq $ring) { $badByEdge["top"]++ } else { $badByEdge["bottom"]++ }
        $badRows[$y] = 1 + $badRows[$y]
      }
    }
  }
  for ($y = 0; $y -lt $H; $y++) {
    foreach ($x in @($ring, ($W - 1 - $ring))) {
      $c = $bmp.GetPixel($x, $y)
      if (-not (Ok $c)) {
        $k = "$($c.R),$($c.G),$($c.B)"
        $hist[$k] = 1 + $hist[$k]
        if ($x -eq $ring) { $badByEdge["left"]++ } else { $badByEdge["right"]++ }
      }
    }
  }
}
# 四角与中心附近的取样，看看"正常背景"到底是什么颜色
$samples = @()
foreach ($pt in @(@(5, 5), @($W - 6, 5), @(5, $H - 6), @($W - 6, $H - 6), @([int]($W / 2), 5), @([int]($W / 2), [int]($H / 2)))) {
  $c = $bmp.GetPixel($pt[0], $pt[1]); $samples += "($($pt[0]),$($pt[1]))=$($c.R),$($c.G),$($c.B)"
}
$bmp.Dispose()

"文件: $File"
"背景取样: " + ($samples -join '  ')
"不合格边框像素按边: top=$($badByEdge.top) bottom=$($badByEdge.bottom) left=$($badByEdge.left) right=$($badByEdge.right)"
"出现最多的不合格颜色（前 8）:"
$hist.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { "   {0,-14} x{1}" -f $_.Key, $_.Value }
"不合格像素所在行（前 8）:"
$badRows.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { "   y={0,-6} x{1}" -f $_.Key, $_.Value }
