param(
  [string]$Source = (Join-Path $PSScriptRoot 'icon-source.png'),
  [string]$OutDir = (Join-Path $PSScriptRoot 'icons'),
  [int]$Padding = 0
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $Source)) {
  Write-Output ('нет исходника: ' + $Source)
  Write-Output 'положите картинку рядом как icon-source.png (квадратную, минимум 512x512)'
  exit 1
}

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$src = [System.Drawing.Image]::FromFile($Source)
$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $inner = $size - 2 * $Padding
  $scale = [Math]::Min($inner / $src.Width, $inner / $src.Height)
  $w = [int][Math]::Round($src.Width * $scale)
  $h = [int][Math]::Round($src.Height * $scale)
  $x = [int][Math]::Round(($size - $w) / 2)
  $y = [int][Math]::Round(($size - $h) / 2)

  $g.DrawImage($src, $x, $y, $w, $h)
  $g.Dispose()

  $path = Join-Path $OutDir ('icon' + $size + '.png')
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ('готово: ' + $path)
}

$src.Dispose()
Write-Output 'иконки обновлены; перезагрузите расширение в браузере'
