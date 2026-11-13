param(
  [string]$Source,
  [string]$OutDir = (Join-Path $PSScriptRoot 'icons')
)

Add-Type -AssemblyName System.Drawing

if (-not $Source) {
  $Source = $env:DUCK_SOURCE
}
if (-not $Source -or -not (Test-Path -LiteralPath $Source)) {
  Write-Output 'нет исходной картинки утки (параметр -Source или переменная DUCK_SOURCE)'
  exit 1
}
if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

function New-RoundedPath([int]$size, [double]$radiusRatio) {
  $r = [int][Math]::Round($size * $radiusRatio)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$master = 512
$canvas = New-Object System.Drawing.Bitmap($master, $master)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$bgPath = New-RoundedPath $master 0.22
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
$g.FillPath($bgBrush, $bgPath)
$bgBrush.Dispose()
$bgPath.Dispose()

$duckImg = [System.Drawing.Image]::FromFile($Source)
$target = [int][Math]::Round($master * 0.74)
$scale = [Math]::Min($target / $duckImg.Width, $target / $duckImg.Height)
$w = [int][Math]::Round($duckImg.Width * $scale)
$h = [int][Math]::Round($duckImg.Height * $scale)
$x = [int][Math]::Round(($master - $w) / 2)
$y = [int][Math]::Round(($master - $h) / 2)
$g.DrawImage($duckImg, $x, $y, $w, $h)
$duckImg.Dispose()
$g.Dispose()

foreach ($size in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.DrawImage($canvas, 0, 0, $size, $size)
  $gg.Dispose()
  $path = Join-Path $OutDir ('icon' + $size + '.png')
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$canvas.Save((Join-Path $OutDir 'icon512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()
Write-Output ('иконки собраны в ' + $OutDir)
