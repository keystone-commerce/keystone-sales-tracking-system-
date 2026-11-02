import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'src/server.js'], {cwd: root + '/backend', stdio: 'inherit'}),
  spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','-p','3210'], {cwd:root, stdio:'inherit'})
];
let closing = false;
function stop(code = 0) { if (closing) return; closing = true; children.forEach(c=>c.kill()); process.exitCode = code; }
children.forEach(c=>c.on('exit', code=>stop(code || 0)));
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
