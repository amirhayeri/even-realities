// One-command beta release: build, pack, upload, promote. Usage: npm run release -- "what changed"
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { version, package_id } = JSON.parse(readFileSync('app.json', 'utf8'));
const msg = process.argv.slice(2).join(' ') || `Bio HUD ${version}`;
const run = (c) => { console.log('\n$ ' + c); execSync(c, { stdio: 'inherit' }); };
run('npx vite build');
run('npx evenhub pack app.json dist -o even-hud.ehpk');
run(`npx evenhub upload even-hud.ehpk -m "${msg.replace(/"/g, '\\"')}" --package-id ${package_id}`);
run(`npx evenhub promote ${version} --to beta --package-id ${package_id}`);
console.log(`\nBeta -> ${version}. Update Bio HUD in the Even Hub tab on the phone.`);
