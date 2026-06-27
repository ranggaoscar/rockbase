module.exports = {
  apps: [
    {
      name: "rockbase-api",
      script: "npm.cmd",
      args: "run dev",
      cwd: "./backend",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      shell: true,
      env: {
        NODE_ENV: "development",
        RUN_WORKERS_SEPARATELY: "true"
      }
    },
    {
      name: "rockbase-worker",
      script: "npm.cmd",
      args: "run worker",
      cwd: "./backend",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      shell: true,
      env: {
        NODE_ENV: "development",
        RUN_WORKERS_SEPARATELY: "true"
      }
    },
    {
      name: "rockbase-frontend",
      script: "npm.cmd",
      args: "run dev",
      cwd: "./frontend",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      shell: true,
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};
