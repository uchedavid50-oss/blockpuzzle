import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const web = readFileSync('dist/index.html', 'utf8');
const native = readFileSync('dist-native/index.html', 'utf8');
assert.match(web, /<script async src="https:\/\/pagead2\.googlesyndication\.com/);
assert.doesNotMatch(native, /<script[^>]+(?:adsbygoogle|gsi\/client)/);
assert.doesNotMatch(native, /rel="manifest"/);
for (const path of ['par.json', 'icon-192.png', 'privacy.html']) assert.ok(existsSync(`dist-native/${path}`));
console.log('Web AdSense verification preserved; native shell excludes ad/auth scripts and includes offline assets.');
