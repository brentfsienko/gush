// `npm run waitlist`: who's waiting for which sold-out size (from the live site's Cloudflare KV).
// "emailed" means the back-in-stock email already went out (see worker/waitlist.ts).
import { execFileSync } from 'node:child_process';

const raw = execFileSync('npx', ['wrangler', 'kv', 'key', 'list', '--binding', 'STOCK', '--prefix', 'want:', '--remote'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const keys = JSON.parse(raw.slice(raw.indexOf('[')));
if (!keys.length) {
  console.log('nobody on the waitlist yet.');
  process.exit(0);
}
const groups = new Map();
for (const k of keys) {
  const [slug, size, ...rest] = k.name.slice('want:'.length).split(':');
  const id = `${slug} (${size.toUpperCase()})`;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push({ email: rest.join(':'), ...(k.metadata ?? {}) });
}
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '?');
for (const [id, people] of groups) {
  const waiting = people.filter((p) => !p.sent).length;
  console.log(`\n${id}: ${waiting} waiting`);
  for (const p of people.sort((a, b) => a.at - b.at))
    console.log(`  ${p.email.padEnd(36)} signed up ${day(p.at)}${p.sent ? `, emailed ${day(p.sent)}` : ''}`);
}
