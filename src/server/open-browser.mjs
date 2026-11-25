import {spawn} from 'node:child_process';

const COMMANDS = {
  win32: (target) => ['rundll32.exe', ['url.dll,FileProtocolHandler', target]],
  darwin: (target) => ['open', [target]],
  linux: (target) => ['xdg-open', [target]],
};

/**
 * Åbner en adresse eller fil i standardprogrammet. Gør intet, hvis styresystemet ikke
 * understøttes, og en fejl (fx manglende xdg-open) stopper aldrig appen.
 * `platform` og `spawnProcess` kan udskiftes i tests.
 */
export function openInBrowser(target, {platform = process.platform, spawnProcess = spawn} = {}) {
  const build = COMMANDS[platform];
  if (!build) return false;
  const [command, args] = build(target);
  const child = spawnProcess(command, args, {windowsHide: true, stdio: 'ignore', detached: true});
  child.on('error', () => {});
  child.unref();
  return true;
}
