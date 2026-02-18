#!/bin/bash
# UFW Firewall Rules for Trading Bot
# Run with sudo on your Manjaro server

set -e

echo "=== Setting up UFW Firewall ==="

# Enable UFW
echo "[1/4] Enabling UFW..."
sudo ufw --force enable

# Default policies
echo "[2/4] Setting default policies..."
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (important!)
echo "[3/4] Allowing SSH..."
sudo ufw allow 22/tcp comment 'SSH'

# Allow Cloudflare IP ranges (for tunnel)
# Cloudflare uses these ranges
sudo ufw allow from 173.245.48.0/20 comment 'Cloudflare'
sudo ufw allow from 103.21.244.0/20 comment 'Cloudflare'
sudo ufw allow from 103.22.200.0/22 comment 'Cloudflare'
sudo ufw allow from 103.31.4.0/22 comment 'Cloudflare'
sudo ufw allow from 104.16.0.0/12 comment 'Cloudflare'
sudo ufw allow from 172.64.0.0/13 comment 'Cloudflare'
sudo ufw allow from 131.0.72.0/22 comment 'Cloudflare'

# Allow localhost (for local access)
sudo ufw allow from 127.0.0.1 comment 'Localhost'

# Enable firewall
echo "[4/4] Reloading UFW..."
sudo ufw reload

# Show status
echo ""
echo "=== UFW Status ==="
sudo ufw status verbose

echo ""
echo "=== Firewall Setup Complete ==="
echo "Ports allowed:"
echo "  - SSH (22)"
echo "  - Cloudflare (for tunnel)"
echo "  - Localhost"
echo ""
echo "Bot API runs on port 3847 (only accessible via tunnel)"
