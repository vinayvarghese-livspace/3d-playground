# 3D Playground
Browser-based tool that prepares product photos for marketplace naming rules: enter a 13-digit EAN, pick a product type, drop in images, and download one EAN.zip of 3000×3000 PNGs named EAN_Seq_ShotCode.png.

Optional AI upscale: images under 3000 px (from 2000 px) are upscaled 2x with Adobe Firefly before conversion. This needs an Adobe subscription with Firefly access, Node.js, and `firefly-upscaler\start-service.bat` running on the PC. Without it, images are processed entirely in the browser and nothing is uploaded.
