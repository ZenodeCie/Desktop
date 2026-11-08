#!/bin/bash

# Zenode Host Simple Development Launcher
# Simpler version that addresses network connection issues

# Set colors for better visibility
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default configuration
CORE_DIR="../Core"
APP_DIR="."
CORE_PORT=3000
APP_PORT=1420

# Function to display error and exit
function exit_with_error() {
    echo -e "${RED}❌ Error: $1${NC}"
    echo ""
    echo -e "${YELLOW}🔧 Troubleshooting steps:${NC}"
    echo "1. Check if the Core directory exists: ls -la $CORE_DIR"
    echo "2. Check if you have write permissions in the directories"
    echo "3. Verify Node.js is installed: node --version"
    echo "4. Check if ports $CORE_PORT and $APP_PORT are available:"
    echo "   lsof -i :$CORE_PORT"
    echo "   lsof -i :$APP_PORT"
    echo "5. Check for firewall restrictions"
    exit 1
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if Node.js is installed
check_node() {
    if ! command_exists node; then
        exit_with_error "Node.js is not installed. Please install Node.js >= 18.0.0"
    fi

    NODE_VERSION=$(node --version)
    MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        exit_with_error "Node.js version $NODE_VERSION is too old. Please install Node.js >= 18.0.0"
    fi

    echo -e "${GREEN}✅ Node.js $NODE_VERSION found${NC}"
}

# Function to start the Core API
echo_core() {
    echo -e "${BLUE}🚀 Starting Zenode Core API...${NC}"
    
    # Check if Core directory exists
    if [ ! -d "$CORE_DIR" ]; then
        exit_with_error "Core directory '$CORE_DIR' not found. Please check the path."
    fi
    
    cd "$CORE_DIR"
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        exit_with_error "package.json not found in Core directory."
    fi
    
    echo -e "${YELLOW}📦 Installing Core dependencies...${NC}"
    npm install > core-install.log 2>&1
    
    if [ $? -ne 0 ]; then
        exit_with_error "Failed to install Core dependencies. Check core-install.log for details."
    fi
    
    echo -e "${YELLOW}🔧 Starting Core API on port $CORE_PORT...${NC}"
    echo "   Core API will be available at: http://localhost:$CORE_PORT"
    echo "   Press Ctrl+C to stop the Core API"
    echo ""
    
    # Start the Core API
    npm start -- --port $CORE_PORT > ../core.log 2>&1 &
    
    CORE_PID=$!
    
    # Wait for Core to start and check if it's running
    sleep 3
    
    if ! kill -0 $CORE_PID 2>/dev/null; then
        echo -e "${RED}❌ Core API failed to start. Check ../core.log for details.${NC}"
        cat ../core.log
        exit 1
    fi
    
    # Test if the Core API is responding
    echo -e "${YELLOW}🔍 Testing Core API connectivity...${NC}"
    curl -s "http://localhost:$CORE_PORT/health" > /dev/null 2>&1
    
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠️  Core API may not be fully ready yet. Waiting...${NC}"
        sleep 5
        curl -s "http://localhost:$CORE_PORT/health" > /dev/null 2>&1
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}❌ Core API is not responding. Please check the logs.${NC}"
            cat ../core.log
            exit 1
        fi
    fi
    
    echo -e "${GREEN}✅ Core API started successfully on port $CORE_PORT (PID: $CORE_PID)${NC}"
    
    # Save the PID for later use
    echo $CORE_PID > ../core.pid
    
    # Wait for user to continue or interrupt
    echo ""
    echo -e "${YELLOW}⏳ Waiting for Desktop app... (Press Ctrl+C to stop Core API only)${NC}"
    wait $CORE_PID
}

# Function to start the Desktop app
echo_app() {
    echo -e "${BLUE}🖥️  Starting Zenode Host Desktop application...${NC}"
    
    # Check if package.json exists in app directory
    if [ ! -f "$APP_DIR/package.json" ]; then
        exit_with_error "package.json not found in Desktop directory."
    fi
    
    cd "$APP_DIR"
    
    echo -e "${YELLOW}📦 Installing Desktop dependencies...${NC}"
    npm install > app-install.log 2>&1
    
    if [ $? -ne 0 ]; then
        exit_with_error "Failed to install Desktop dependencies. Check app-install.log for details."
    fi
    
    echo -e "${YELLOW}🔧 Starting Desktop app on port $APP_PORT...${NC}"
    echo "   Desktop app will be available at: http://localhost:$APP_PORT"
    echo "   Press Ctrl+C to stop the Desktop app"
    echo ""
    
    # Start the Desktop app
    npm run tauri:dev > ../app.log 2>&1 &
    
    APP_PID=$!
    
    # Save the PID for later use
    echo $APP_PID > ../app.pid
    
    echo -e "${GREEN}✅ Desktop app started successfully on port $APP_PORT (PID: $APP_PID)${NC}"
    
    # Wait for user to continue or interrupt
    echo ""
    echo -e "${YELLOW}⏳ Waiting for user input... (Press Ctrl+C to stop Desktop app only)${NC}"
    wait $APP_PID
}

# Function to handle script termination
trap 'echo -e "${YELLOW}⚠️  Development servers stopped.${NC}"; exit 0' INT TERM

# Main execution
echo -e "${BLUE}🎯 Zenode Host Simple Development Environment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"
check_node

echo -e "${GREEN}✅ Prerequisites checked successfully${NC}"
echo ""

# Check if Core API is already running
if lsof -i :$CORE_PORT > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Core API is already running on port $CORE_PORT${NC}"
    echo "   You can still start the Desktop app separately."
else
    echo -e "${YELLOW}🔍 Checking port availability...${NC}"
    if lsof -i :$APP_PORT > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Desktop app is already running on port $APP_PORT${NC}"
        echo "   You can still start the Core API separately."
    fi
fi

echo ""

# Ask user what they want to launch
read -p "🔧 What would you like to launch? (1: Both, 2: Core only, 3: Desktop only): " choice

case $choice in
    1)
        echo ""
        echo -e "${GREEN}🚀 Launching both Core API and Desktop app...${NC}"
        echo ""
        echo_core &
        sleep 2
        echo_app
        ;;
    2)
        echo ""
        echo -e "${GREEN}🚀 Launching Core API only...${NC}"
        echo ""
        echo_core
        ;;
    3)
        echo ""
        echo -e "${GREEN}🚀 Launching Desktop app only...${NC}"
        echo ""
        echo_app
        ;;
    *)
        echo -e "${RED}❌ Invalid choice. Please run the script again.${NC}"
        exit 1
        ;;
esac

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Development environment ready!${NC}"