# 3D Playground
Browser-based tool that prepares product photos for marketplace naming rules: enter a 13-digit EAN, pick a product type, drop in images, and download one EAN.zip of 3000×3000 PNGs named EAN_Seq_ShotCode.png.

Optional AI upscale: images under 3000 px (from 2000 px) are upscaled 2x with Adobe Firefly before conversion. This needs an Adobe subscription with Firefly access and the local upscaler on the PC. Setup steps are in the page under ⚙ Settings › AI upscale setup. `Setup.bat` installs to `D:\3d-playground` when the PC has a local, writable D drive, otherwise to `%USERPROFILE%\3d-playground`. Without AI upscale, images are processed entirely in the browser and nothing is uploaded.

After changing the page or the upscaler, rebuild the setup zip before pushing: `powershell -ExecutionPolicy Bypass -File tools\make-package.ps1`.
