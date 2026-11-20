#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repo = if ($env:NEXUS_INSTALL_REPO) { $env:NEXUS_INSTALL_REPO } else { "masralai/nexus" }
$BinDir = Join-Path $env:USERPROFILE ".local\bin"
$Arch = $env:PROCESSOR_ARCHITECTURE

switch ($Arch.ToLower()) {
  "amd64" { $Asset = "nexus-windows-amd64.exe" }
  "arm64" { $Asset = "nexus-windows-arm64.exe" }
  "x86"   { $Asset = "nexus-windows-amd64.exe" }
  default { Write-Error "unsupported architecture: $Arch (expected amd64/arm64)"; exit 1 }
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Dest = Join-Path $BinDir "nexus.exe"
$Base = "https://github.com/$Repo/releases/latest/download"
$Url = "$Base/$Asset"
$ChecksumsUrl = "$Base/checksums.txt"

Write-Host "downloading $Asset"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
  $ChecksumsPath = Join-Path $BinDir "checksums.txt"
  Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -UseBasicParsing
} catch {
  Write-Error "download failed: $_`nURL: $Url`nTip: no Release assets yet (need $Asset and checksums.txt). Use: bunx --package masralai/nexus nexus"
  exit 1
}

$Line = Select-String -Path $ChecksumsPath -Pattern ("^\s*([a-fA-F0-9]{64})\s+\*?" + [regex]::Escape($Asset) + "$") | Select-Object -First 1
if (-not $Line) {
  Write-Error "nexus: no checksum for $Asset in checksums.txt"
  exit 1
}
$Want = ($Line.Matches[0].Groups[1].Value).ToLower()
$Got = (Get-FileHash -Algorithm SHA256 -Path $Dest).Hash.ToLower()
if ($Want -ne $Got) {
  Write-Error "nexus: checksum mismatch for $Asset"
  exit 1
}
Write-Host "verified $Asset"
Remove-Item $ChecksumsPath -Force -ErrorAction SilentlyContinue

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
  $env:Path += ";$BinDir"
  Write-Host "added to PATH: $BinDir (restart shell to pick up)"
}

try { & $Dest --version } catch { Write-Warning "installed but --version failed: $_" }
Write-Host "installed $Dest"
