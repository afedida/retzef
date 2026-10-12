# Windows PowerShell 5.1 compatible static server for the Retzef dist folder.
param(
  [int]$Port = 43123,
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if (-not $Root) {
  $Root = Join-Path $PSScriptRoot "dist"
}
$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $Root)) {
  Write-Host "Missing folder: $Root"
  exit 1
}

$Mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".map"  = "application/json; charset=utf-8"
  ".wasm" = "application/wasm"
  ".onnx" = "application/octet-stream"
  ".ort"  = "application/octet-stream"
  ".bin"  = "application/octet-stream"
  ".data" = "application/octet-stream"
  ".model" = "application/octet-stream"
  ".pb"   = "application/octet-stream"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
  ".ttf"  = "font/ttf"
  ".otf"  = "font/otf"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif"  = "image/gif"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".webp" = "image/webp"
  ".mp4"  = "video/mp4"
  ".webm" = "video/webm"
  ".mp3"  = "audio/mpeg"
  ".wav"  = "audio/wav"
  ".txt"  = "text/plain; charset=utf-8"
  ".cube" = "text/plain; charset=utf-8"
}

function Get-SafePath([string]$localPath) {
  $rel = [System.Uri]::UnescapeDataString($localPath)
  $rel = $rel.Replace("\", "/")
  if ($rel.Contains("..")) { return $null }
  $rel = $rel.TrimStart("/")
  if ($rel -eq "") { $rel = "index.html" }
  $rel = $rel.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
  $rootFull = $Root
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  if (Test-Path -LiteralPath $full -PathType Container) {
    $full = Join-Path $full "index.html"
  }
  return $full
}

function Send-Bytes($response, $stream, [int64]$start, [int64]$count) {
  $stream.Position = $start
  $buf = New-Object byte[] 65536
  $left = $count
  while ($left -gt 0) {
    $take = $buf.Length
    if ($left -lt $take) { $take = [int]$left }
    $n = $stream.Read($buf, 0, $take)
    if ($n -le 0) { break }
    $response.OutputStream.Write($buf, 0, $n)
    $left -= $n
  }
}

function Send-Response($context) {
  $response = $context.Response
  $response.Headers.Add("X-Content-Type-Options", "nosniff")
  $path = Get-SafePath $context.Request.Url.LocalPath
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $response.StatusCode = 404
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("404")
    $response.ContentType = "text/plain; charset=utf-8"
    $response.ContentLength64 = $bytes.Length
    if ($context.Request.HttpMethod -ne "HEAD") {
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $response.Close()
    return
  }

  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  $type = $Mime[$ext]
  if (-not $type) { $type = "application/octet-stream" }
  $response.ContentType = $type
  $response.Headers.Add("Accept-Ranges", "bytes")

  $fs = New-Object System.IO.FileStream $path, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read), ([System.IO.FileShare]::Read)
  try {
    $len = $fs.Length
    $start = [int64]0
    $end = $len - 1
    $range = $context.Request.Headers["Range"]
    if ($range -and $range.StartsWith("bytes=") -and $len -gt 0) {
      $spec = $range.Substring(6).Split(",")[0]
      $parts = $spec.Split("-")
      if ($parts[0] -ne "") { $start = [int64]$parts[0] }
      if ($parts.Length -gt 1 -and $parts[1] -ne "") { $end = [int64]$parts[1] }
      if ($start -lt 0 -or $end -lt $start -or $start -ge $len) {
        $response.StatusCode = 416
        $response.Headers.Add("Content-Range", "bytes */$len")
        $response.Close()
        return
      }
      if ($end -ge $len) { $end = $len - 1 }
      $response.StatusCode = 206
      $response.Headers.Add("Content-Range", "bytes $start-$end/$len")
    }
    if ($len -eq 0) {
      $response.ContentLength64 = 0
      $response.Close()
      return
    }
    $count = ($end - $start) + 1
    $response.ContentLength64 = $count
    if ($context.Request.HttpMethod -ne "HEAD") {
      Send-Bytes $response $fs $start $count
    }
    $response.Close()
  } finally {
    $fs.Dispose()
  }
}

function Start-Listener([string[]]$prefixes) {
  $tryListener = New-Object System.Net.HttpListener
  foreach ($prefix in $prefixes) {
    $tryListener.Prefixes.Add($prefix)
  }
  try {
    $tryListener.Start()
    return $tryListener
  } catch {
    $tryListener.Close()
    return $null
  }
}

$listener = Start-Listener @("http://localhost:$Port/", "http://127.0.0.1:$Port/")
if (-not $listener) { $listener = Start-Listener @("http://localhost:$Port/") }
if (-not $listener) { $listener = Start-Listener @("http://127.0.0.1:$Port/") }
if (-not $listener) {
  Write-Host "Could not listen on port $Port."
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host "Retzef is running at $url"
Write-Host "Close this window to stop."
if ($env:OS -eq "Windows_NT") {
  try { Start-Process $url } catch {}
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      Send-Response $context
    } catch {
      try {
        $context.Response.StatusCode = 500
        $context.Response.Close()
      } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
