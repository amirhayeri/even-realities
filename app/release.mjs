// One-command beta release: bump, build, pack, upload, promote.
// Usage: npm run release -- "what changed"
// The patch version in app.json is bumped automatically (0.1.6 -> 0.1.7), so a
// release never fails on "version already exists". Pass --no-bump to keep it.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const noBump = args.includes('--no-bump');
const app = JSON.parse(readFileSync('app.json', 'utf8'));
if (!noBump) {
  const [maj, min, pat] = String(app.version).split('.').map(n => parseInt(n, 10) || 0);
  app.version = `${maj}.${min}.${pat + 1}`;
  writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
  console.log(`app.json version -> ${app.version}`);
}
const { version, package_id } = app;
const msg = args.filter(a => a !== '--no-bump').join(' ') || `Bio HUD ${version}`;
const run = (c) => { console.log('\n$ ' + c); execSync(c, { stdio: 'inherit' }); };
run('npx vite build');
run('npx evenhub pack app.json dist -o even-hud.ehpk');
run(`npx evenhub upload even-hud.ehpk -m "${msg.replace(/"/g, '\\"')}" --package-id ${package_id}`);
run(`npx evenhub promote ${version} --to beta --package-id ${package_id}`);
console.log(`\nBeta -> ${version}. Update Bio HUD in the Even Hub tab on the phone.`);
