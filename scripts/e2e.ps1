$ErrorActionPreference = 'Stop'

$baseUrl = 'http://localhost:8080'
$artifactDir = Join-Path $PSScriptRoot '..\.e2e'
$artifactDir = [System.IO.Path]::GetFullPath($artifactDir)
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(1280, 720)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$rectangle = [System.Drawing.Rectangle]::new(0, 0, 1280, 720)
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $rectangle,
  [System.Drawing.Color]::FromArgb(18, 60, 58),
  [System.Drawing.Color]::FromArgb(239, 183, 74),
  25
)
$font = [System.Drawing.Font]::new('Arial', 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$graphics.FillRectangle($brush, $rectangle)
$graphics.DrawString('FrameFoundry E2E', $font, [System.Drawing.Brushes]::White, 310, 310)
$imagePath = Join-Path $artifactDir 'sample.jpg'
$bitmap.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$font.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()

$email = "e2e-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$registered = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/register" -ContentType 'application/json' -Body (@{
  displayName = 'E2E Tester'
  email = $email
  password = 'Password123!'
} | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($registered.token)" }

$project = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/projects" -Headers $headers -ContentType 'application/json' -Body (@{
  title = 'E2E Demo'
  topic = 'Hành trình mùa hè'
} | ConvertTo-Json)

$presign = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/uploads/presign" -Headers $headers -ContentType 'application/json' -Body (@{
  projectId = $project.project.id
  fileName = 'sample.jpg'
  contentType = 'image/jpeg'
} | ConvertTo-Json)

& curl.exe --fail --silent --show-error -X PUT -H 'Content-Type: image/jpeg' --upload-file $imagePath $presign.uploadUrl
if ($LASTEXITCODE -ne 0) { throw 'Upload vào object storage thất bại' }

Invoke-RestMethod -Method Post -Uri "$baseUrl/api/projects/$($project.project.id)/assets" -Headers $headers -ContentType 'application/json' -Body (@{
  objectKey = $presign.objectKey
  fileName = 'sample.jpg'
  contentType = 'image/jpeg'
  sizeBytes = (Get-Item $imagePath).Length
} | ConvertTo-Json) | Out-Null

$render = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/projects/$($project.project.id)/render" -Headers @{
  Authorization = "Bearer $($registered.token)"
  'Idempotency-Key' = [guid]::NewGuid().ToString()
} -ContentType 'application/json' -Body (@{
  topic = 'Hành trình mùa hè'
  voice = 'vi-VN-HoaiMyNeural'
  imageDuration = 3
  resolution = '720p'
} | ConvertTo-Json)

$jobId = $render.job.id
Write-Host "Job: $jobId"
$finalJob = $null
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  $current = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/jobs/$jobId" -Headers $headers
  Write-Host "$($current.job.status) $($current.job.progress)% $($current.job.stage)"
  if ($current.job.status -in @('COMPLETED', 'FAILED', 'CANCELED')) {
    $finalJob = $current.job
    break
  }
  Start-Sleep -Seconds 3
}

if (-not $finalJob) { throw 'Render job quá thời gian chờ' }
if ($finalJob.status -ne 'COMPLETED') { throw "Render thất bại: $($finalJob.error_code)" }

$outputPath = Join-Path $artifactDir 'output.mp4'
& curl.exe --fail --silent --show-error -o $outputPath $finalJob.download_url
if ($LASTEXITCODE -ne 0) { throw 'Tải video thành phẩm thất bại' }

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,codec_type,width,height -of json $outputPath
Write-Host "E2E hoàn tất: $outputPath"

