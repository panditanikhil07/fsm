#!/bin/bash

# Base directory (current directory)
BASE_DIR="$(pwd)"

echo "Starting all projects..."

# Open first tab + start FastAPI Backend
gnome-terminal --tab -- bash -c "
cd \"$BASE_DIR/backend\" || exit
echo 'Starting Backend...'
npm run dev
exec bash
"
# Open second  tab + start Frontend
gnome-terminal --tab -- bash -c "
cd \"$BASE_DIR/frontend\" || exit
echo 'Starting Frontend...'
npm run dev
exec bash
"

echo "All projects are starting..."
                                      
