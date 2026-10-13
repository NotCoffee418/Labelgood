#!/bin/bash
set -e

# Labelgood Installation Script
# Downloads the latest Labelgood release and installs it for the current user
# (~/.local, no root needed). Run it again to update.
#
# Prefer a package? Releases also have an AppImage, a .deb and an .rpm.

REPO="NotCoffee418/Labelgood"
INSTALL_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
MIME_DIR="${HOME}/.local/share/mime"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "  Labelgood Installation Script"
echo "======================================"
echo ""

# Detect architecture (Linux x86_64 and ARM64 binaries are published)
detect_arch() {
    local os=$(uname -s)
    if [ "$os" != "Linux" ]; then
        echo -e "${RED}Error: Unsupported operating system: $os (only Linux is supported by this script)${NC}" >&2
        exit 1
    fi

    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}" >&2
            echo "Prebuilt binaries are available for x86_64 and ARM64. Please build from source." >&2
            exit 1
            ;;
    esac
}

# Get the latest release version
get_latest_version() {
    echo -e "${YELLOW}Fetching latest release information...${NC}" >&2
    
    # Try to use jq if available for robust JSON parsing
    if command -v jq &> /dev/null; then
        local version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | jq -r '.tag_name')
    else
        # Fallback to grep/sed if jq is not available
        local version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | head -1 | sed -E 's/.*"tag_name"[^"]*"([^"]+)".*/\1/')
    fi
    
    if [ -z "$version" ] || [ "$version" = "null" ]; then
        echo -e "${RED}Error: Could not fetch latest version${NC}" >&2
        exit 1
    fi
    
    echo "$version"
}

# Download and install
install_labelgood() {
    local arch version
    arch=$(detect_arch)
    version=$(get_latest_version)
    
    echo -e "${GREEN}Detected architecture: $arch${NC}"
    echo -e "${GREEN}Latest version: $version${NC}"
    echo ""
    
    local filename="labelgood-${version}-linux-${arch}.tar.gz"
    local download_url="https://github.com/${REPO}/releases/download/${version}/${filename}"
    
    echo -e "${YELLOW}Downloading from: $download_url${NC}"
    
    # Create temporary directory
    local tmp_dir=$(mktemp -d)
    cd "$tmp_dir"
    
    # Download the archive
    if ! curl -fL -o "$filename" "$download_url"; then
        echo -e "${RED}Error: Failed to download Labelgood${NC}" >&2
        cd - > /dev/null
        rm -rf "$tmp_dir"
        exit 1
    fi
    
    # Extract the archive
    echo -e "${YELLOW}Extracting archive...${NC}"
    if ! tar -xzf "$filename"; then
        echo -e "${RED}Error: Failed to extract archive (possibly corrupted download)${NC}" >&2
        cd - > /dev/null
        rm -rf "$tmp_dir"
        exit 1
    fi
    
    # Verify binary exists after extraction
    if [ ! -f "labelgood" ]; then
        echo -e "${RED}Error: Binary not found in archive${NC}" >&2
        cd - > /dev/null
        rm -rf "$tmp_dir"
        exit 1
    fi
    
    # Create install directory if it doesn't exist
    mkdir -p "$INSTALL_DIR"
    
    # Check if binary already exists
    if [ -f "${INSTALL_DIR}/labelgood" ]; then
        echo -e "${YELLOW}Existing installation found. Removing old version...${NC}"
        rm -f "${INSTALL_DIR}/labelgood"
    fi
    
    # Move binary to install directory
    echo -e "${YELLOW}Installing to ${INSTALL_DIR}...${NC}"
    mv labelgood "$INSTALL_DIR/"
    chmod +x "${INSTALL_DIR}/labelgood"

    # Icon for the menu entry (included in newer releases)
    if [ -f "labelgood.png" ]; then
        mkdir -p "$ICON_DIR"
        mv labelgood.png "${ICON_DIR}/labelgood.png"
    fi
    
    # Clean up
    cd - > /dev/null
    rm -rf "$tmp_dir"
    
    echo -e "${GREEN}✓ Labelgood installed successfully!${NC}"
}

# Create desktop shortcut
create_desktop_shortcut() {
    echo ""
    echo -e "${YELLOW}Creating desktop shortcut...${NC}"
    
    # Create directories if they don't exist
    mkdir -p "$DESKTOP_DIR"
    mkdir -p "$ICON_DIR"
    
    # Create .desktop file
    cat > "${DESKTOP_DIR}/labelgood.desktop" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Labelgood
Comment=Label editor and printer
Exec=${INSTALL_DIR}/labelgood %f
Icon=labelgood
StartupWMClass=labelgood
Terminal=false
Categories=Utility;
MimeType=application/x-labelgood;
EOF
    
    chmod +x "${DESKTOP_DIR}/labelgood.desktop"
    
    # Update desktop database if available
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✓ Desktop shortcut created${NC}"
}

# Register the .labelgood file type, so label files open in Labelgood
register_file_type() {
    mkdir -p "${MIME_DIR}/packages"
    cat > "${MIME_DIR}/packages/com.labelgood.app.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-labelgood">
    <comment>Labelgood label</comment>
    <sub-class-of type="application/json"/>
    <glob pattern="*.labelgood"/>
    <icon name="labelgood"/>
  </mime-type>
</mime-info>
EOF

    if command -v update-mime-database &> /dev/null; then
        update-mime-database "$MIME_DIR" 2>/dev/null || true
    fi
    if command -v xdg-mime &> /dev/null; then
        xdg-mime default labelgood.desktop application/x-labelgood 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ .labelgood files open with Labelgood${NC}"
}

# The binary uses the system's WebKitGTK and GTK; tell the user what to install if they're missing
check_runtime_libraries() {
    if ! command -v ldd &> /dev/null; then
        return
    fi
    local missing
    missing=$(ldd "${INSTALL_DIR}/labelgood" 2>/dev/null | grep "not found" | awk '{print $1}' || true)
    if [ -n "$missing" ]; then
        echo ""
        echo -e "${YELLOW}Labelgood needs some system libraries that aren't installed:${NC}"
        echo "$missing" | sed 's/^/    /'
        echo ""
        echo "Install WebKitGTK 4.1, for example:"
        echo "    Fedora:        sudo dnf install webkit2gtk4.1"
        echo "    Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0"
        echo "    Arch:          sudo pacman -S webkit2gtk-4.1"
        echo ""
        echo "Or use the AppImage from the releases page, which includes them."
    fi
}

# Check for required commands
check_requirements() {
    local missing_deps=()
    
    for cmd in curl tar; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=($cmd)
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo -e "${RED}Error: Missing required dependencies: ${missing_deps[*]}${NC}" >&2
        echo "Please install them and try again." >&2
        exit 1
    fi
}

# Main installation flow
main() {
    check_requirements
    install_labelgood
    create_desktop_shortcut
    register_file_type
    check_runtime_libraries
    
    echo ""
    echo "======================================"
    echo -e "${GREEN}Installation complete!${NC}"
    echo "======================================"
    echo ""
    echo "To run Labelgood, type: labelgood"
    echo ""
    
    # Check if install directory is in PATH
    if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
        echo -e "${YELLOW}Note: ${INSTALL_DIR} is not in your PATH${NC}"
        echo "Add the following line to your ~/.bashrc or ~/.zshrc:"
        echo ""
        echo "    export PATH=\"\$PATH:${INSTALL_DIR}\""
        echo ""
    fi
}

main
