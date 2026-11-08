#!/bin/bash

# Zenode Host Development Stopper
# Stops both Core API and Desktop app processes

# Set colors for better visibility
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Script configuration
CORE_DIR="../Core"
APP_DIR="."
CORE_LOG="core.log"
APP_LOG="app.log"
CORE_PID_FILE="core.pid"
APP_PID_FILE="app.pid"

# Function to display help
function show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Stops Zenode Host development processes (Core API and Desktop app)."
    echo ""
    echo "Options:"
    echo "  --core-only          Stop only the Core API (default: both)"
    echo "  --app-only          Stop only the Desktop app"
    echo "  --force             Force stop processes (skip waiting)"
    echo "  --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Stop both Core and Desktop app"
    echo "  $0 --core-only       # Stop only Core API"
    echo "  $0 --app-only        # Stop only Desktop app"
    echo "  $0 --force           # Force stop all processes"
}

# Function to check if a process is running
is_process_running() {
    local pid=$1
    local name=$2
    
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 1  # Process is not running
    fi
    
    return 0  # Process is running
}

# Function to stop a process gracefully
stop_process() {
    local pid=$1
    local name=$2
    local log_file=$3
    
    if [ -z "$pid" ]; then
        echo -e "${YELLOW}⚠️  No PID found for $name (file $pid_file not found or empty)${NC}"
        return 1
    fi
    
    if is_process_running "$pid" "$name"; then
        echo -e "${YELLOW}⏳ Stopping $name (PID: $pid)...${NC}"
        
        # Send SIGTERM (graceful shutdown)
        kill -TERM "$pid" 2>/dev/null
        
        # Wait for process to stop (up to 10 seconds)
        local timeout=10
        local count=0
        
        while is_process_running "$pid" "$name" && [ $count -lt $timeout ]; do
            sleep 1
            count=$((count + 1))
        done
        
        if is_process_running "$pid" "$name"; then
            echo -e "${YELLOW}⚠️  $name did not stop gracefully, forcing stop...${NC}"
            kill -KILL "$pid" 2>/dev/null
            sleep 2
        fi
        
        if is_process_running "$pid" "$name"; then
            echo -e "${RED}❌ Failed to stop $name (PID: $pid)${NC}"
            return 1
        else
            echo -e "${GREEN}✅ $name stopped successfully (PID: $pid)${NC}"
            return 0
        fi
    else
        echo -e "${YELLOW}ℹ️  $name was not running (PID: $pid)${NC}"
        return 0
    fi
}

# Function to read PID from file
read_pid() {
    local pid_file=$1
    
    if [ ! -f "$pid_file" ]; then
        return 1
    fi
    
    local pid=$(cat "$pid_file" | tr -d '\r\n' | head -1)
    
    if [ -z "$pid" ] || ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    
    echo "$pid"
}

# Function to check if PID file exists and is valid
validate_pid_file() {
    local pid_file=$1
    local name=$2
    
    if [ ! -f "$pid_file" ]; then
        echo -e "${YELLOW}⚠️  $name PID file not found: $pid_file${NC}"
        return 1
    fi
    
    local pid=$(read_pid "$pid_file")
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠️  $name PID file is invalid or empty: $pid_file${NC}"
        return 1
    fi
    
    return 0
}

# Function to force stop all processes
force_stop_all() {
    echo -e "${RED}🔥 Force stopping all processes...${NC}"
    
    # Stop Core API if running
    if [ -f "$CORE_PID_FILE" ]; then
        local core_pid=$(read_pid "$CORE_PID_FILE")
        if [ -n "$core_pid" ]; then
            kill -KILL "$core_pid" 2>/dev/null
            echo -e "${GREEN}✅ Core API force stopped${NC}"
        fi
    fi
    
    # Stop Desktop app if running
    if [ -f "$APP_PID_FILE" ]; then
        local app_pid=$(read_pid "$APP_PID_FILE")
        if [ -n "$app_pid" ]; then
            kill -KILL "$app_pid" 2>/dev/null
            echo -e "${GREEN}✅ Desktop app force stopped${NC}"
        fi
    fi
    
    # Also check for processes listening on common ports
    if lsof -ti :3000 > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Found processes on port 3000, stopping...${NC}"
        kill -9 $(lsof -ti :3000) 2>/dev/null
        echo -e "${GREEN}✅ Processes on port 3000 stopped${NC}"
    fi
    
    if lsof -ti :1420 > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Found processes on port 1420, stopping...${NC}"
        kill -9 $(lsof -ti :1420) 2>/dev/null
        echo -e "${GREEN}✅ Processes on port 1420 stopped${NC}"
    fi
    
    # Remove PID files
    rm -f "$CORE_PID_FILE"
    rm -f "$APP_PID_FILE"
    
    echo -e "${GREEN}✅ All processes force stopped successfully${NC}"
}

# Function to handle script termination
trap 'echo -e "${YELLOW}⚠️  Stop script completed.${NC}"; exit 0' INT TERM

# Main execution
echo -e "${BLUE}🛑 Zenode Host Development Stopper${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Parse command line arguments
LAUNCH_BOTH=true
FORCE_STOP=false

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
        --force)
            FORCE_STOP=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Change to app directory
cd "$APP_DIR" || exit_with_error "Cannot cd to app directory"

if [ "$LAUNCH_BOTH" = true ]; then
    echo -e "${YELLOW}🛑 Stopping both Core API and Desktop app...${NC}"
    
    # Stop Desktop app
    if [ -f "$APP_PID_FILE" ]; then
        local app_pid=$(read_pid "$APP_PID_FILE")
        stop_process "$app_pid" "Desktop app" "$APP_LOG"
        rm -f "$APP_PID_FILE"
    else
        echo -e "${YELLOW}ℹ️  Desktop app PID file not found: $APP_PID_FILE${NC}"
    fi
    
    echo ""
    
    # Stop Core API
    if [ -f "$CORE_PID_FILE" ]; then
        local core_pid=$(read_pid "$CORE_PID_FILE")
        stop_process "$core_pid" "Core API" "$CORE_LOG"
        rm -f "$CORE_PID_FILE"
    else
        echo -e "${YELLOW}ℹ️  Core API PID file not found: $CORE_PID_FILE${NC}"
    fi
    
else
    if [ "$CORE_ONLY" = true ]; then
        echo -e "${YELLOW}🛑 Stopping Core API only...${NC}"
        
        if validate_pid_file "$CORE_PID_FILE" "Core API"; then
            local core_pid=$(read_pid "$CORE_PID_FILE")
            stop_process "$core_pid" "Core API" "$CORE_LOG"
            rm -f "$CORE_PID_FILE"
        fi
        
    elif [ "$APP_ONLY" = true ]; then
        echo -e "${YELLOW}🛑 Stopping Desktop app only...${NC}"
        
        if validate_pid_file "$APP_PID_FILE" "Desktop app"; then
            local app_pid=$(read_pid "$APP_PID_FILE")
            stop_process "$app_pid" "Desktop app" "$APP_LOG"
            rm -f "$APP_PID_FILE"
        fi
        
    fi
fi

# Force stop if requested
if [ "$FORCE_STOP" = true ]; then
    echo ""
    force_stop_all
fi

# Show status of processes
if [ "$LAUNCH_BOTH" = true ] || [ "$APP_ONLY" = true ]; then
    echo ""
    echo -e "${YELLOW}🔍 Checking if Desktop app is still running...${NC}"
    if lsof -ti :$APP_PORT > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Desktop app is still running on port $APP_PORT${NC}"
        echo -e "${YELLOW}   To stop it manually:${NC}"
        echo -e "   ${YELLOW}   lsof -ti :$APP_PORT | xargs kill -9${NC}"
    else
        echo -e "${GREEN}✅ Desktop app is not running on port $APP_PORT${NC}"
    fi
fi

if [ "$LAUNCH_BOTH" = true ] || [ "$CORE_ONLY" = true ]; then
    echo ""
    echo -e "${YELLOW}🔍 Checking if Core API is still running...${NC}"
    if lsof -ti :$CORE_PORT > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Core API is still running on port $CORE_PORT${NC}"
        echo -e "${YELLOW}   To stop it manually:${NC}"
        echo -e "   ${YELLOW}   lsof -ti :$CORE_PORT | xargs kill -9${NC}"
    else
        echo -e "${GREEN}✅ Core API is not running on port $CORE_PORT${NC}"
    fi
fi

echo ""
if [ "$FORCE_STOP" = true ]; then
    echo -e "${GREEN}🎉 All processes force stopped!${NC}"
else
    echo -e "${GREEN}🎉 Development processes stopped successfully!${NC}"
fi
echo -e "${GREEN}   You can start them again with: ./start-dev.sh${NC}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"