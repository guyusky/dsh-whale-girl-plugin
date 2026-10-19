# import-actions.ps1 — 把"动作序列帧"导入成插件素材
#
# 与 build-assets.ps1 的区别（关键）：
#   build-assets 每张图各算自己的包围盒 → 表情之间本来就是独立姿势，没问题；
#   动作序列帧必须**三帧共用同一套变换**（scale/bx/by），否则每帧各自对齐会引入抖动，
#   看起来像"动作在抖"而不是"角色在做动作"。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\import-actions.ps1 -Id act-peek -SourceDir D:\dsh-code\source\act-peek
param(
  [Parameter(Mandatory = $true)][string]$Id,               # 输出前缀，如 act-peek
  [Parameter(Mandatory = $true)][string]$SourceDir,        # 帧所在目录
  [string]$PluginDir = '',
  [string]$AnchorFrame = '',                               # 用作对齐基准的帧（默认第一帧）
  [int]$OutW = 384, [int]$OutH = 512,
  [double]$BodyFrac = 0.86, [double]$FootFrac = 0.95,
  [int]$MinCh = 232, [int]$MaxDiff = 12,
  [switch]$DryRun
)
if (-not $PluginDir) { $PluginDir = Split-Path $PSScriptRoot -Parent }
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'keytool.cs') -ReferencedAssemblies 'System.Drawing'
Add-Type -AssemblyName System.Drawing

$assetsDir = Join-Path $PluginDir 'assets'
if (!(Test-Path $SourceDir)) { throw "帧目录不存在：$SourceDir" }
$frames = Get-ChildItem (Join-Path $SourceDir '*.png') | Where-Object { $_.Name -notlike '_*' } | Sort-Object Name
if ($frames.Count -eq 0) { throw "目录里没有帧（png）：$SourceDir" }

$ref = if ($AnchorFrame) { $frames | Where-Object { $_.Name -like "*$AnchorFrame*" } | Select-Object -First 1 }
       else { $frames[0] }
if (-not $ref) { throw "找不到基准帧：$AnchorFrame" }

# ---- 1) 用基准帧算一次变换（三帧共用）----
$b = [KeyTool]::BoundsOf($ref.FullName, $MinCh, $MaxDiff)
if ($b[2] -le $b[0] -or $b[3] -le $b[1]) { throw "基准帧前景包围盒异常：$($b -join ',')" }
$bx = ($b[0] + $b[2]) / 2.0                       # 底边中点 = 锚点
$by = $b[3]
$scale = ($OutH * $BodyFrac) / ($b[3] - $b[1] + 1)
$ox = $OutW / 2.0
$oy = $OutH * $FootFrac

Write-Host "动作      : $Id"
Write-Host "帧数      : $($frames.Count)（基准帧 $($ref.Name)）"
Write-Host ("变换      : scale={0:N4} 锚点=({1:N1},{2:N1}) 画布={3}x{4} 落点=({5:N1},{6:N1})" -f $scale, $bx, $by, $OutW, $OutH, $ox, $oy)

# ---- 2) 逐帧渲染（同一套变换）----
$i = 0
$results = @()
foreach ($f in $frames) {
  $i++
  $name = '{0}-{1:D2}.png' -f $Id, $i
  $dst = Join-Path $assetsDir $name
  if ($DryRun) {
    Write-Host ("  帧 {0} -> {1}（DryRun）" -f $f.Name, $name)
    continue
  }
  [KeyTool]::Render($f.FullName, $dst, $scale, $bx, $by, $OutW, $OutH, $ox, $oy, $MinCh, $MaxDiff, $MinCh, 252)
  $ab = [KeyTool]::AlphaBoundsOf($dst)
  $results += [pscustomobject]@{ Name = $name; Bounds = $ab; Size = (Get-Item $dst).Length }
  Write-Host ("  帧 {0,-10} -> {1,-18} {2,7:N0} B  透明包围盒 ({3},{4})-({5},{6})" -f `
      $f.Name, $name, (Get-Item $dst).Length, $ab[0], $ab[1], $ab[2], $ab[3])
}

# ---- 3) 帧间一致性自检（对齐是否稳）----
if (-not $DryRun -and $results.Count -ge 2) {
  $a0 = $results[0].Bounds
  $worst = 0
  foreach ($r in $results[1..($results.Count - 1)]) {
    $a = $r.Bounds
    $d = @(($a[0] - $a0[0]), ($a[1] - $a0[1]), ($a[2] - $a0[2]), ($a[3] - $a0[3]))
    $m = ($d | ForEach-Object { [Math]::Abs($_) } | Measure-Object -Maximum).Maximum
    if ($m -gt $worst) { $worst = $m }
    Write-Host ("  帧间差 {0} vs {1}: dL={2} dT={3} dR={4} dB={5}" -f $results[0].Name, $r.Name, $d[0], $d[1], $d[2], $d[3])
  }
  $pct = [Math]::Round(100.0 * $worst / $OutH, 2)
  $verdict = if ($pct -le 2.0) { 'OK（≤2% 画布高，符合验收）' } else { '注意：超过 2% 画布高，播放时可能看出抖动' }
  Write-Host ("一致性    : 最大帧间差 {0}px = 画布高 {1}% -> {2}" -f $worst, $pct, $verdict)
}
Write-Host "完成。素材已写入 $assetsDir"
