const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');

const extraEnv = process.platform === 'linux'
  ? {
      LIBGL_ALWAYS_SOFTWARE: '1',
      GDK_BACKEND: 'x11',
      GSETTINGS_BACKEND: 'memory',
    }
  : {};

const extraArgs = process.platform === 'linux'
  ? ['--no-sandbox', '--disable-gpu', '--in-process-gpu', '--disable-dev-shm-usage']
  : [];

const child = spawn(electronBinary, [...extraArgs, '.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...extraEnv,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Electron konnte nicht gestartet werden:', error.message);
  process.exit(1);
});
