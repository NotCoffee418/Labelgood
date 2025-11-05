#!/bin/bash
set -e

# Labelgood Installation Script
# This script downloads and installs the latest version of Labelgood

REPO="NotCoffee418/Labelgood"
INSTALL_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "  Labelgood Installation Script"
echo "======================================"
echo ""

# Detect architecture
detect_arch() {
    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        armv7l|armv7)
            echo "armv7"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}" >&2
            exit 1
            ;;
    esac
}

# Get the latest release version
get_latest_version() {
    echo -e "${YELLOW}Fetching latest release information...${NC}"
    
    # Try to use jq if available for robust JSON parsing
    if command -v jq &> /dev/null; then
        local version=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | jq -r '.tag_name')
    else
        # Fallback to grep/sed if jq is not available
        local version=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | head -1 | sed -E 's/.*"tag_name"[^"]*"([^"]+)".*/\1/')
    fi
    
    if [ -z "$version" ] || [ "$version" = "null" ]; then
        echo -e "${RED}Error: Could not fetch latest version${NC}" >&2
        exit 1
    fi
    
    echo "$version"
}

# Download and install
install_labelgood() {
    local arch=$(detect_arch)
    local version=$(get_latest_version)
    
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
    if ! curl -L -o "$filename" "$download_url"; then
        echo -e "${RED}Error: Failed to download Labelgood${NC}" >&2
        rm -rf "$tmp_dir"
        exit 1
    fi
    
    # Extract the archive
    echo -e "${YELLOW}Extracting archive...${NC}"
    tar -xzf "$filename"
    
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
Comment=Label management application
Exec=${INSTALL_DIR}/labelgood
Icon=labelgood
Terminal=false
Categories=Utility;
EOF
    
    chmod +x "${DESKTOP_DIR}/labelgood.desktop"
    
    # Update desktop database if available
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✓ Desktop shortcut created${NC}"
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
