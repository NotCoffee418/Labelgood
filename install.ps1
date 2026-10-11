# Labelgood installation script for Windows
# Downloads the latest release's installer and installs Labelgood for the current user
# (no administrator rights needed). Run it again to update.

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 may default to old TLS versions, and its progress bar slows downloads down a lot
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"

$REPO = "NotCoffee418/Labelgood"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Labelgood Installation Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

function Get-Installer([string]$arch) {
    Write-Host "Fetching latest release information..." -ForegroundColor Yellow
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -eq "Labelgood-setup-$arch.exe" } | Select-Object -First 1
    if (-not $asset -and $arch -eq "arm64") {
        # Older releases have no ARM64 build; Windows on ARM runs x64 apps through emulation
        Write-Host "No ARM64 installer in this release; using the x64 one (runs through emulation)." -ForegroundColor Yellow
        $asset = $release.assets | Where-Object { $_.name -eq "Labelgood-setup-x64.exe" } | Select-Object -First 1
    }
    if (-not $asset) {
        throw "The latest release ($($release.tag_name)) has no Windows installer"
    }
    Write-Host "Latest version: $($release.tag_name)" -ForegroundColor Green
    return $asset
}

# Earlier versions of this script copied labelgood.exe into a folder and added it to PATH.
# The installer replaces that, so remove the old copy (its desktop shortcut gets replaced).
function Remove-OldPortableInstall {
    $oldDir = Join-Path $env:LOCALAPPDATA "Programs\Labelgood"
    if (Test-Path (Join-Path $oldDir "labelgood.exe")) {
        Write-Host "Removing the old portable installation..." -ForegroundColor Yellow
        Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath) {
        $parts = $userPath -split ';' | Where-Object { $_ -ne '' -and $_ -ne $oldDir }
        $cleaned = $parts -join ';'
        if ($cleaned -ne $userPath.TrimEnd(';')) {
            [Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
        }
    }
}

function Install-Labelgood {
    $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
        "AMD64" { "x64" }
        "ARM64" { "arm64" }
        default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
    }

    $asset = Get-Installer $arch
    $tmpDir = Join-Path $env:TEMP "labelgood-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $setup = Join-Path $tmpDir $asset.name

    try {
        Write-Host "Downloading $($asset.name)..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $setup -UseBasicParsing

        Remove-OldPortableInstall

        # /S = silent: installs for the current user with Start menu and desktop shortcuts
        Write-Host "Installing..." -ForegroundColor Yellow
        $process = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "The installer exited with code $($process.ExitCode)"
        }
    }
    finally {
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    Install-Labelgood
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Start Labelgood from the Start menu or the desktop shortcut." -ForegroundColor White
    Write-Host "Uninstall it from Settings > Apps like any other app." -ForegroundColor White
    Write-Host ""
}
catch {
    Write-Host ""
    Write-Host "Installation failed: $_" -ForegroundColor Red
    exit 1
}
