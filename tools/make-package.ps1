# Builds dist\3D-Playground.zip with only what another PC needs to run the app and the AI upscaler.
$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $env:TEMP '3D-Playground'
$zip = Join-Path $root 'dist\3D-Playground.zip'

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$stage\firefly-upscaler" -Force | Out-Null

'index.html', 'app.js', 'styles.css', 'data.js', 'README.md', 'Setup.bat', 'Start 3D Playground.bat' |
  ForEach-Object { Copy-Item (Join-Path $root $_) $stage }

'config.js', 'firefly.js', 'server.js', 'upscale.js', 'check-login.js', 'package.json', 'package-lock.json',
  'start-chrome.bat', 'start-service.bat', 'register-launcher.bat', '.gitignore' |
  ForEach-Object { Copy-Item (Join-Path $root "firefly-upscaler\$_") "$stage\firefly-upscaler" }

New-Item -ItemType Directory -Path (Split-Path $zip) -Force | Out-Null
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Get-Item $zip | Select-Object FullName, Length
