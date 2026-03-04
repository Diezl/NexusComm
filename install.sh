#!/bin/bash
set -e

# ============================================================
#  NexusComm — Automated VPS Installer (Ubuntu 22.04/Debian 12)
#  Run as root: bash install.sh
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run this script as root: sudo bash install.sh"

REPO="https://github.com/Diezl/nexuscomm.git"
APP_DIR="/opt/nexuscomm"
APP_USER="nexuscomm"
DB_NAME="nexuscomm"
DB_USER="nexuscomm"
DB_PASS=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
NODE_VERSION="20"

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   NexusComm Installer                     ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ── Collect config ────────────────────────────────────────────
read -p "Enter your domain or server IP (e.g. nexus.example.com or 1.2.3.4): " DOMAIN
read -p "Telegram bot token (leave blank to skip): " TELEGRAM_TOKEN
read -p "Dropbox access token (leave blank to skip): " DROPBOX_TOKEN

echo ""
info "Starting installation..."

# ── Update system ─────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl wget git nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib ufw build-essential
success "System packages installed."

# ── Node.js 20 via NodeSource ─────────────────────────────────
info "Installing Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - > /dev/null 2>&1
apt-get install -y -qq nodejs
node_ver=$(node --version)
npm_ver=$(npm --version)
success "Node.js ${node_ver} / npm ${npm_ver} installed."

# ── PM2 ───────────────────────────────────────────────────────
info "Installing PM2..."
npm install -g pm2 --quiet
success "PM2 installed."

# ── PostgreSQL setup ──────────────────────────────────────────
info "Configuring PostgreSQL..."
systemctl enable postgresql --quiet
systemctl start postgresql

sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || \
  sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null || \
  warn "Database '${DB_NAME}' may already exist — continuing."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
success "PostgreSQL configured. DB: ${DB_NAME}, User: ${DB_USER}"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

# ── App user ──────────────────────────────────────────────────
info "Creating app user '${APP_USER}'..."
id -u "${APP_USER}" &>/dev/null || useradd --system --shell /bin/bash --create-home "${APP_USER}"
success "User '${APP_USER}' ready."

# ── Clone / update repo ───────────────────────────────────────
info "Cloning NexusComm from GitHub..."
if [[ -d "${APP_DIR}/.git" ]]; then
  warn "App directory exists — pulling latest..."
  git -C "${APP_DIR}" pull
else
  git clone "${REPO}" "${APP_DIR}"
fi
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
success "Repository cloned to ${APP_DIR}"

# ── Write .env ────────────────────────────────────────────────
info "Writing environment config..."
cat > "${APP_DIR}/.env" << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
DROPBOX_ACCESS_TOKEN=${DROPBOX_TOKEN}
EOF
chmod 600 "${APP_DIR}/.env"
chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
success ".env written."

# ── Install npm deps & build ──────────────────────────────────
info "Installing npm dependencies (this may take a minute)..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm install --production=false --quiet"

info "Building app..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm run build"
success "App built successfully."

# ── Push DB schema ────────────────────────────────────────────
info "Pushing database schema..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && DATABASE_URL='${DATABASE_URL}' npm run db:push" || \
  warn "DB push had warnings — may need manual check."
success "Database schema applied."

# ── PM2 service ───────────────────────────────────────────────
info "Configuring PM2 process manager..."
cat > /tmp/nexuscomm-pm2.json << EOF
{
  "name": "nexuscomm",
  "script": "npm",
  "args": "run start",
  "cwd": "${APP_DIR}",
  "env": {
    "NODE_ENV": "production",
    "PORT": "5000"
  },
  "env_file": "${APP_DIR}/.env",
  "restart_delay": 3000,
  "max_restarts": 10,
  "watch": false
}
EOF

sudo -u "${APP_USER}" bash -c "pm2 start /tmp/nexuscomm-pm2.json"
sudo -u "${APP_USER}" bash -c "pm2 save"
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" | tail -1 | bash || true
success "PM2 configured — NexusComm will start on boot."

# ── Firewall ──────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 80
ufw allow 443
success "Firewall: SSH, HTTP, HTTPS allowed."

# ── Nginx config ──────────────────────────────────────────────
info "Configuring Nginx..."
cat > /etc/nginx/sites-available/nexuscomm << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Max upload size (matches 50MB server limit)
    client_max_body_size 55M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSocket support (chat, video calls, SSH terminal)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/nexuscomm /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
success "Nginx configured."

# ── SSL (skip if IP address) ──────────────────────────────────
if [[ "${DOMAIN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  warn "Domain is an IP address — skipping SSL. Access via http://${DOMAIN}"
  warn "For PWA installation on phones, point a domain at this IP and re-run with: certbot --nginx -d yourdomain.com"
else
  info "Obtaining SSL certificate for ${DOMAIN}..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email || \
    warn "SSL certificate failed — check DNS propagation and try: certbot --nginx -d ${DOMAIN}"
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   NexusComm installed successfully!        ${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  App URL:     ${CYAN}http${DOMAIN:+s}://${DOMAIN}${NC}"
echo -e "  App dir:     ${APP_DIR}"
echo -e "  DB name:     ${DB_NAME}"
echo -e "  DB password: ${DB_PASS}  ${YELLOW}(saved in ${APP_DIR}/.env)${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "  ${CYAN}pm2 logs nexuscomm${NC}      — view live logs"
echo -e "  ${CYAN}pm2 restart nexuscomm${NC}   — restart the app"
echo -e "  ${CYAN}pm2 status${NC}              — check process status"
echo -e "  ${CYAN}pm2 monit${NC}               — live CPU/memory dashboard"
echo ""
echo -e "  To update later:"
echo -e "  ${CYAN}cd ${APP_DIR} && git pull && npm install && npm run build && pm2 restart nexuscomm${NC}"
echo ""
