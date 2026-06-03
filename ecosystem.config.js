module.exports = {
  apps: [{
    name: 'ziyouniao',
    script: 'app.js',
    cwd: 'F:/ziyouniao',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    env: { NODE_ENV: 'production' },
    error_file: './logs/error.log',
    out_file: './logs/app.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
}
