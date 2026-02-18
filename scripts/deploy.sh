#!/bin/bash
# Trading Bot Deployment Setup Script
# Run on your Manjaro home server

set -e

echo "=== Trading Bot Deployment Setup ==="

# 1. Install dependencies
echo "[1/5] Installing dependencies..."
if command -v pacman &> /dev/null; then
    # Manjaro/Arch
    sudo pacman -S --noconfirm bun pm2 cloudflared ufw
elif command -v apt &> /dev/null; then
    # Debian/Ubuntu
    curl -fsSL https://bun.sh/install | bash
    sudo npm install -g pm2
    # Cloudflare Tunnel
    wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    sudo mv cloudflared /usr/local/bin/
    sudo chmod +x /usr/local/bin/cloudflared
fi

# 2. Clone and setup bot
echo "[2/5] Setting up bot..."
cd ~
git clone https://github.com/Jokke7/tradingbot.git
cd tradingbot
bun install

# 3. Configure environment
echo "[3/5] Configuring environment..."
cp src/dexter/.env .env
# Edit .env with your API keys
echo "Edit .env with your API keys!"

# 4. Start with pm2
echo "[4/5] Starting bot with pm2..."
pm2 start ecosystem.config.cjs
pm2 save

# 5. Cloudflare Tunnel (manual step required)
echo "[5/5] Cloudflare Tunnel setup..."
echo "Run these commands to set up the tunnel:"
echo ""
echo "=== Cloudflare Tunnel Setup (MANUAL STEP) ==="
echo ""
echo "Since you already have Cloudflare tunnels, add this to your existing config:"
echo ""
echo "1. Edit your existing ~/.cloudflared/config.yml"
echo "2. Add this ingress rule BEFORE your catch-all:"
echo ""
echo '    - hostname: api.trading.godot.no'
echo '      service: http://localhost:3847'
echo ""
echo "3. Restart cloudflared: pm2 restart cloudflared"
echo ""
echo "=== Setup Complete ==="
