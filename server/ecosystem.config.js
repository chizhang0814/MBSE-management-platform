module.exports = {
  apps: [{
    name: 'eicd-platform',
    script: 'dist/index.js',
    cwd: '/var/www/eicd-platform/server',
    instances: 2,  // 根据CPU核心数调整，建议设置为CPU核心数
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/eicd-platform-error.log',
    out_file: '/var/log/pm2/eicd-platform-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false,
    // 优雅重启
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};

