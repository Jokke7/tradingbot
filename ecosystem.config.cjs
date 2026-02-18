module.exports = {
  apps: [
    {
      name: 'trading-bot',
      script: './src/bot/index.ts',
      args: '--autonomous',
      interpreter: 'bun',
      watch: false,
      env: {
        NODE_ENV: 'production',
        TRADING_MODE: 'paper',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '200M',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
    },
  ],
};
