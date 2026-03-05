module.exports = {
  apps: [
    {
      name: 'gwi-pos',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_type: 'json',
    },
    {
      name: 'berg-bridge',
      script: 'scripts/berg-bridge.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '100M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        GWI_POS_URL: 'http://localhost:3005',
        BERG_ENABLED: 'true',
        // GWI_BRIDGE_SECRETS: set in /opt/gwi-pos/.env — JSON map of deviceId to plaintext secret
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/berg-bridge-error.log',
      out_file: './logs/berg-bridge-out.log',
      merge_logs: true,
    },
  ],
}
