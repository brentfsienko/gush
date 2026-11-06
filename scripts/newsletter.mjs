// `npm run newsletter`: everyone on the newsletter list (from the live site's Cloudflare KV), oldest
// first, then all the addresses on one line to paste into an email's BCC. See worker/newsletter.ts.
import { execFileSync } from 'node:child_process';

const raw = execFileSync('npx', ['wrangler', 'kv', 'key', 'list', '--binding', 'STOCK', '--prefix', 'news:', '--remote'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const people = JSON.parse(raw.slice(raw.indexOf('[')))
  .map((k) => ({ email: k.name.slice('news:'.length), at: k.metadata?.at ?? 0 }))
  .sort((a, b) => a.at - b.at);
if (!people.length) {
  console.log('nobody on the newsletter yet.');
  process.exit(0);
}
console.log(`${people.length} on the newsletter:\n`);
for (const p of people) console.log(`  ${p.email.padEnd(36)} signed up ${p.at ? new Date(p.at).toISOString().slice(0, 10) : '?'}`);
console.log(`\nall (for BCC):\n${people.map((p) => p.email).join(', ')}`);
