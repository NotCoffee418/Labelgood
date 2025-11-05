# Labelgood Installation Script for Windows
# This script downloads and installs the latest version of Labelgood

$ErrorActionPreference = "Stop"

$REPO = "NotCoffee418/Labelgood"
$INSTALL_DIR = "$env:LOCALAPPDATA\Programs\Labelgood"
$DESKTOP_DIR = [Environment]::GetFolderPath("Desktop")

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Labelgood Installation Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Detect architecture
function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        "AMD64" { return "amd64" }
        "x86_64" { return "amd64" }
        default {
            Write-Host "Error: Unsupported architecture: $arch" -ForegroundColor Red
            exit 1
        }
    }
}

# Get the latest release version
function Get-LatestVersion {
    Write-Host "Fetching latest release information..." -ForegroundColor Yellow
    
    try {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
        $version = $response.tag_name
        
        if ([string]::IsNullOrEmpty($version)) {
            throw "Version not found in response"
        }
        
        return $version
    }
    catch {
        Write-Host "Error: Could not fetch latest version - $_" -ForegroundColor Red
        exit 1
    }
}

# Download and install Labelgood
function Install-Labelgood {
    $arch = Get-Architecture
    $version = Get-LatestVersion
    
    Write-Host "Detected architecture: $arch" -ForegroundColor Green
    Write-Host "Latest version: $version" -ForegroundColor Green
    Write-Host ""
    
    $filename = "labelgood-$version-windows-$arch.zip"
    $downloadUrl = "https://github.com/$REPO/releases/download/$version/$filename"
    
    Write-Host "Downloading from: $downloadUrl" -ForegroundColor Yellow
    
    # Create temporary directory
    $tmpDir = Join-Path $env:TEMP "labelgood-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    
    $zipPath = Join-Path $tmpDir $filename
    
    try {
        # Download the archive
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
        
        # Extract the archive
        Write-Host "Extracting archive..." -ForegroundColor Yellow
        Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
        
        # Create install directory if it doesn't exist
        if (-not (Test-Path $INSTALL_DIR)) {
            New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
        }
        
        # Check if binary already exists
        $exePath = Join-Path $INSTALL_DIR "labelgood.exe"
        if (Test-Path $exePath) {
            Write-Host "Existing installation found. Removing old version..." -ForegroundColor Yellow
            Remove-Item $exePath -Force
        }
        
        # Move binary to install directory
        Write-Host "Installing to $INSTALL_DIR..." -ForegroundColor Yellow
        $extractedExe = Join-Path $tmpDir "labelgood.exe"
        Move-Item $extractedExe $exePath -Force
        
        Write-Host "✓ Labelgood installed successfully!" -ForegroundColor Green
    }
    finally {
        # Clean up
        if (Test-Path $tmpDir) {
            Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# Create desktop shortcut
function New-DesktopShortcut {
    Write-Host ""
    Write-Host "Creating desktop shortcut..." -ForegroundColor Yellow
    
    $exePath = Join-Path $INSTALL_DIR "labelgood.exe"
    $shortcutPath = Join-Path $DESKTOP_DIR "Labelgood.lnk"
    
    $WScriptShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
    $Shortcut.TargetPath = $exePath
    $Shortcut.WorkingDirectory = $INSTALL_DIR
    $Shortcut.Description = "Label management application"
    $Shortcut.Save()
    
    Write-Host "✓ Desktop shortcut created" -ForegroundColor Green
}

# Add to PATH if not already present
function Add-ToPath {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ([string]::IsNullOrEmpty($currentPath)) {
        $currentPath = ""
    }
    
    if ($currentPath -notlike "*$INSTALL_DIR*") {
        Write-Host ""
        Write-Host "Adding Labelgood to PATH..." -ForegroundColor Yellow
        
        # Handle semicolon separator properly
        if ([string]::IsNullOrEmpty($currentPath)) {
            $newPath = $INSTALL_DIR
        }
        elseif ($currentPath.EndsWith(";")) {
            $newPath = "$currentPath$INSTALL_DIR"
        }
        else {
            $newPath = "$currentPath;$INSTALL_DIR"
        }
        
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        
        # Update PATH for current session
        $env:Path = "$env:Path;$INSTALL_DIR"
        
        Write-Host "✓ Added to PATH" -ForegroundColor Green
    }
}

# Main installation flow
function Main {
    Install-Labelgood
    New-DesktopShortcut
    Add-ToPath
    
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To run Labelgood, type: labelgood" -ForegroundColor White
    Write-Host "Or use the desktop shortcut" -ForegroundColor White
    Write-Host ""
    Write-Host "Note: You may need to restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    Write-Host ""
}

# Run main
try {
    Main
}
catch {
    Write-Host ""
    Write-Host "Installation failed: $_" -ForegroundColor Red
    exit 1
}
