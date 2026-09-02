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
$Url = "https://github.com/$Repo/releases/latest/download/$Asset"

Write-Host "downloading $Url"
try {
  # Use TLS 1.2
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
} catch {
  Write-Error "download failed: $_`nURL: $Url`nTip: no Release asset yet — use: bunx --package masralai/nexus nexus  or  irm https://raw.githubusercontent.com/masralai/nexus/main/web/install.ps1 | iex"
  exit 1
}

# Ensure bin is on PATH for current session
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
  $env:Path += ";$BinDir"
  Write-Host "added to PATH: $BinDir (restart shell to pick up)"
}

try { & $Dest --version } catch { Write-Warning "installed but --version failed: $_" }
Write-Host "installed $Dest"
