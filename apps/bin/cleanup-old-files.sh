#!/bin/bash

# Script to delete files and directories older than 2 days based on creation time
# Root directory: /home/ec2-user/efs-mount-new/
# Special handling for canvas and screenshots directories:
#   - Deletes only first-level folders (and their contents) older than 2 days
# All deletions run in parallel for performance

set -euo pipefail

ROOT_DIR="/home/ec2-user/efs-mount-new"
DAYS_OLD=2
LOG_DIR="/var/log/cleanup-efs"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Generate timestamp for log files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_MAIN="$LOG_DIR/main_${TIMESTAMP}.log"
LOG_CANVAS="$LOG_DIR/canvas_${TIMESTAMP}.log"
LOG_SCREENSHOTS="$LOG_DIR/screenshots_${TIMESTAMP}.log"

# Check if root directory exists
if [[ ! -d "$ROOT_DIR" ]]; then
    echo "Error: Root directory $ROOT_DIR does not exist"
    exit 1
fi

echo "Starting cleanup of files created more than $DAYS_OLD days ago in $ROOT_DIR"
echo "Running deletions in parallel..."
echo "Logs will be saved to: $LOG_DIR"
echo "---"

# Function to clean main directory
cleanup_main() {
    {
        echo "=== Main Directory Cleanup Started at $(date) ==="
        echo "Cleaning main directory (excluding canvas and screenshots)..."
        find "$ROOT_DIR" \
            -mindepth 1 \
            -maxdepth 1 \
            ! -name "canvas" \
            ! -name "screenshots" \
            -ctime +$DAYS_OLD \
            -print \
            -exec rm -rf {} \;
        echo "Main directory cleanup completed at $(date)"
        echo "=== End of Main Directory Cleanup ==="
    } 2>&1 | tee "$LOG_MAIN"
}

# Function to clean canvas directory
cleanup_canvas() {
    {
        echo "=== Canvas Directory Cleanup Started at $(date) ==="
        if [[ -d "$ROOT_DIR/canvas" ]]; then
            echo "Cleaning first-level folders in canvas directory..."
            find "$ROOT_DIR/canvas" \
                -mindepth 1 \
                -maxdepth 1 \
                -type d \
                -ctime +$DAYS_OLD \
                -print \
                -exec rm -rf {} \;
            echo "Canvas directory cleanup completed at $(date)"
        else
            echo "Canvas directory does not exist, skipping..."
        fi
        echo "=== End of Canvas Directory Cleanup ==="
    } 2>&1 | tee "$LOG_CANVAS"
}

# Function to clean screenshots directory
cleanup_screenshots() {
    {
        echo "=== Screenshots Directory Cleanup Started at $(date) ==="
        if [[ -d "$ROOT_DIR/screenshots" ]]; then
            echo "Cleaning first-level folders in screenshots directory..."
            find "$ROOT_DIR/screenshots" \
                -mindepth 1 \
                -maxdepth 1 \
                -type d \
                -ctime +$DAYS_OLD \
                -print \
                -exec rm -rf {} \;
            echo "Screenshots directory cleanup completed at $(date)"
        else
            echo "Screenshots directory does not exist, skipping..."
        fi
        echo "=== End of Screenshots Directory Cleanup ==="
    } 2>&1 | tee "$LOG_SCREENSHOTS"
}

# Run all cleanup operations in parallel
cleanup_main &
cleanup_canvas &
cleanup_screenshots &

# Wait for all background jobs to complete
wait

echo "---"
echo "All cleanup operations completed"
echo ""
echo "Log files:"
echo "  Main directory: $LOG_MAIN"
echo "  Canvas directory: $LOG_CANVAS"
echo "  Screenshots directory: $LOG_SCREENSHOTS"
