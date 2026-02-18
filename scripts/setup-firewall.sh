#!/bin/bash
# UFW Firewall Rules for Trading Bot
# Run with sudo on your Manjaro server
# NOTE: This adds rules - won't interfere with existing setup

set -e

echo "=== Adding UFW Rules for Trading Bot ==="

# Enable UFW if not already
echo "[1/3] Checking UFW status..."
sudo ufw status | grep -q "Status: active" && echo "UFW already active" || sudo ufw --force enable

# Allow SSH (if not already)
echo "[2/3] Allowing SSH..."
sudo ufw allow 22/tcp comment 'SSH' 2>/dev/null || true

# Allow Cloudflare IP ranges (for tunnel)
echo "[3/3] Allowing Cloudflare ranges..."
for range in 173.245.48.0/20 103.21.244.0/20 103.22.200.0/22 103.31.4.0/22 104.16.0.0/12 172.64.0.0/13 131.0.72.0/22; do
    sudo ufw allow from $range comment 'Cloudflare' 2>/dev/null || true
done

# Allow localhost
sudo ufw allow from 127.0.0.1 comment 'Localhost' 2>/dev/null || true

sudo ufw reload

echo ""
echo "=== UFW Status ==="
sudo ufw status verbose

echo ""
echo "=== Done ==="
echo "Added rules for SSH, Cloudflare, and localhost."
