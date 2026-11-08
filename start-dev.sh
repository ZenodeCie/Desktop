#!/bin/bash

# Zenode Host Development Launcher
# Launches both the Core API server and the Desktop application

# Set colors for better visibility
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to display help
function show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Launches Zenode Host development environment with both Core API and Desktop app."
    echo ""
    echo "Options:"
    echo "  --core-only          Launch only the Core API (default: both)"
    echo "  --app-only          Launch only the Desktop app"
    echo "  --core-port PORT    Port for Core API (default: 3000)"
    echo "  --app-port PORT     Port for Desktop app (default: 1420)"
    echo "  --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Launch both Core and Desktop app"
    echo "  $0 --core-only       # Launch only Core API"
    echo "  $0 --app-only        # Launch only Desktop app"
}

# Default configuration
CORE_DIR="../Core"
APP_DIR="."
CORE_PORT=3000
APP_PORT=1420
LAUNCH_BOTH=true

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --core-only)
            LAUNCH_BOTH=false
            APP_ONLY=true
            shift
            ;;
        --app-only)
            LAUNCH_BOTH=false
            CORE_ONLY=true
            shift
            ;;
        --core-port)
            CORE_PORT="$2"
            shift 2
            ;;
        --app-port)
            APP_PORT="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if Node.js is installed
check_node() {
    if ! command_exists node; then
        echo -e "${RED}❌ Node.js is not installed. Please install Node.js >= 18.0.0${NC}"
        echo "   macOS: brew install node"
        echo "   Ubuntu/Debian: sudo apt install nodejs npm"
        echo "   Other: https://nodejs.org/en/download/"
        exit 1
    fi

    NODE_VERSION=$(node --version)
    MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        echo -e "${RED}❌ Node.js version $NODE_VERSION is too old. Please install Node.js >= 18.0.0${NC}"
        exit 1
    fi
}

# Function to check if npm is installed
check_npm() {
    if ! command_exists npm; then
        echo -e "${RED}❌ npm is not installed. Please install npm >= 9.0.0${NC}"
        exit 1
    fi

    NPM_VERSION=$(npm --version)
    MAJOR_VERSION=$(echo "$NPM_VERSION" | cut -d. -f1)
    
    if [ "$MAJOR_VERSION" -lt 9 ]; then
        echo -e "${RED}❌ npm version $NPM_VERSION is too old. Please install npm >= 9.0.0${NC}"
        exit 1
    fi
}

# Function to check if Rust and cargo are installed (for Tauri)
check_rust() {
    if ! command_exists cargo; then
        echo -e "${YELLOW}⚠️  Cargo (Rust) not found. Tauri app may need to be built differently.${NC}"
        echo "   If you encounter issues, install Rust: https://rustup.rs/"
    fi
}

# Function to start the Core API
echo_core() {
    echo -e "${BLUE}🚀 Starting Zenode Core API...${NC}"
    
    # Check if Core directory exists
    if [ ! -d "$CORE_DIR" ]; then
        echo -e "${RED}❌ Core directory '$CORE_DIR' not found. Please check the path.${NC}"
        exit 1
    fi
    
    cd "$CORE_DIR"
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        echo -e "${RED}❌ package.json not found in Core directory.${NC}"
        exit 1
    fi
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}📦 Installing Core dependencies...${NC}"
        npm install --silent
    fi
    
    # Start the Core API
    echo -e "${GREEN}✅ Core API starting on http://localhost:$CORE_PORT${NC}"
    echo "   Press Ctrl+C to stop the Core API"
    echo ""
    
    # Use nodemon for development with auto-restart
    if command_exists nodemon; then
        npm run dev -- --port $CORE_PORT
    else
        # Fallback to regular npm start
        npm start -- --port $CORE_PORT
    fi
}

# Function to start the Desktop app
echo_app() {
    echo -e "${BLUE}🖥️  Starting Zenode Host Desktop application...${NC}"
    
    # Check if package.json exists in app directory
    if [ ! -f "$APP_DIR/package.json" ]; then
        echo -e "${RED}❌ package.json not found in Desktop directory.${NC}"
        exit 1
    fi
    
    cd "$APP_DIR"
    
    # Check if dependencies are installed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}📦 Installing Desktop dependencies...${NC}"
        npm install --silent
    fi
    
    # Install Tauri if not present
    if ! command_exists tauri; then
        echo -e "${YELLOW}🔧 Installing Tauri CLI...${NC}"
        npm install -g @tauri-apps/cli
    fi
    
    # Start the Desktop app in development mode
    echo -e "${GREEN}✅ Desktop app starting on http://localhost:$APP_PORT${NC}"
    echo "   Press Ctrl+C to stop the Desktop app"
    echo ""
    
    npm run tauri:dev
}

# Function to handle script termination
trap 'echo -e "${YELLOW}⚠️  Development servers stopped.${NC}"; exit 0' INT TERM

# Main execution
echo -e "${BLUE}🎯 Zenode Host Development Environment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"
check_node
check_npm
check_rust

if [ "$LAUNCH_BOTH" = true ]; then
    echo -e "${GREEN}✅ All prerequisites checked successfully${NC}"
else
    echo -e "${GREEN}✅ All prerequisites checked for selected component${NC}"
fi

echo ""

# Launch components based on user choice
if [ "$LAUNCH_BOTH" = true ]; then
    # Launch both Core and Desktop app in background
    echo -e "${YELLOW}🌐 Launching both Core API and Desktop app...${NC}"
    echo ""
    
    # Start Core API in background
    if command_exists tmux; then
        # Use tmux if available
        tmux new-window -n "core" "bash -c 'cd $(pwd)/$CORE_DIR && npm run dev -- --port $CORE_PORT'"
        tmux new-window -n "app" "bash -c 'cd $(pwd)/$APP_DIR && npm run tauri:dev'"
        echo -e "${GREEN}✅ Development environment started in tmux${NC}"
        echo "   Use tmux commands to manage windows:"
        echo "   - Ctrl+b, then n to create new window"
        echo "   - Ctrl+b, then d to detach"
        echo "   - Ctrl+b, then q to quit tmux"
    elif command_exists screen; then
        # Use screen if available
        screen -t core -dm bash -c "cd $(pwd)/$CORE_DIR && npm run dev -- --port $CORE_PORT"
        screen -t app -dm bash -c "cd $(pwd)/$APP_DIR && npm run tauri:dev"
        echo -e "${GREEN}✅ Development environment started in screen${NC}"
        echo "   Use screen commands to manage windows:"
        echo "   - Ctrl+a, then n for next window"
        echo "   - Ctrl+a, then d to detach"
        echo "   - Ctrl+a, then k to kill screen"
    else
        # Start in background and show instructions
        echo -e "${YELLOW}⚠️  No tmux or screen found. Starting in background...${NC}"
        echo -e "${YELLOW}   To stop all processes, press Ctrl+C${NC}"
        echo ""
        
        # Start Core API in background
        cd "$CORE_DIR" && npm run dev -- --port $CORE_PORT > ../core.log 2>&1 &
        CORE_PID=$!
        
        # Start Desktop app in background
        cd "$APP_DIR" && npm run tauri:dev > ../app.log 2>&1 &
        APP_PID=$!
        
        echo -e "${GREEN}✅ Both services started in background${NC}"
        echo "   Core API PID: $CORE_PID (logs: ../core.log)"
        echo "   Desktop App PID: $APP_PID (logs: ../app.log)"
        echo ""
        echo "📋 You can check the logs with:"
        echo "   tail -f ../core.log    # Core API logs"
        echo "   tail -f ../app.log     # Desktop app logs"
        echo ""
        echo "🛑 To stop all services, press Ctrl+C"
        
        # Wait for user interruption
        wait $CORE_PID $APP_PID
    fi
    
else
    # Launch only the selected component
    if [ "$CORE_ONLY" = true ]; then
        echo_core
    elif [ "$APP_ONLY" = true ]; then
        echo_app
    fi
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Development environment ready!${NC}"