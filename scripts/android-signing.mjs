// Stable development signing, kept private locally and in GitHub Actions secrets.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

process.umask(0o077);
const root = resolve(import.meta.dirname, '..');
const directory = join(root, '.mobile-signing');
const metadata = join(directory, 'signing.json');
const keystore = join(directory, 'bunblocks-ci.p12');
const repository = 'uchedavid50-oss/blockpuzzle';
const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; signing material has not been printed.`);
  return result.stdout;
}

const mode = process.argv[2] ?? 'fingerprints';
if (!['setup', 'upload', 'build', 'fingerprints'].includes(mode)) throw new Error('Use setup, upload, build or fingerprints.');
if (mode === 'setup' && !existsSync(metadata)) {
  if (existsSync(keystore)) throw new Error('Keystore already exists without its metadata; restore the matching backup.');
  run('git', ['check-ignore', '-q', '.mobile-signing/signing.json']);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identity = { alias: 'bunblocks-ci', password: randomBytes(32).toString('base64url') };
  run(keytool, ['-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-alias', identity.alias,
    '-storepass:env', 'BUNBLOCKS_KEYTOOL_PASSWORD', '-keypass:env', 'BUNBLOCKS_KEYTOOL_PASSWORD',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Bunblocks Mobile CI'],
  { env: { ...process.env, BUNBLOCKS_KEYTOOL_PASSWORD: identity.password } });
  writeFileSync(metadata, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  chmodSync(keystore, 0o600);
}
if (!existsSync(metadata) || !existsSync(keystore)) throw new Error('Run setup once, or restore the existing private signing backup.');
const identity = JSON.parse(readFileSync(metadata, 'utf8'));
const certificate = run(keytool, ['-exportcert', '-rfc', '-keystore', keystore, '-alias', identity.alias,
  '-storepass:env', 'BUNBLOCKS_KEYTOOL_PASSWORD'],
{ env: { ...process.env, BUNBLOCKS_KEYTOOL_PASSWORD: identity.password } });
const x509 = new X509Certificate(certificate);
const publicInfo = { applicationId: 'app.bunblocks.game', alias: identity.alias,
  sha1: x509.fingerprint, sha256: x509.fingerprint256, purpose: 'Stable CI development builds; not a store release key' };

if (mode === 'setup') {
  writeFileSync(join(root, 'docs/android-ci-signing.json'), `${JSON.stringify(publicInfo, null, 2)}\n`, { mode: 0o644 });
}
if (mode === 'upload') {
  const variables = JSON.parse(run('gh', ['variable', 'list', '--repo', repository, '--json', 'name,value']));
  const expected = variables.find(v => v.name === 'ANDROID_SIGNING_CERT_SHA256')?.value;
  if (expected && expected !== publicInfo.sha256) throw new Error('GitHub already uses a different signing identity. Do not rotate it.');
  const secrets = {
    ANDROID_SIGNING_KEYSTORE_BASE64: readFileSync(keystore).toString('base64'),
    ANDROID_SIGNING_STORE_PASSWORD: identity.password,
    ANDROID_SIGNING_KEY_ALIAS: identity.alias,
    ANDROID_SIGNING_KEY_PASSWORD: identity.password,
  };
  for (const [name, value] of Object.entries(secrets))
    run('gh', ['secret', 'set', name, '--repo', repository], { input: value });
  run('gh', ['variable', 'set', 'ANDROID_SIGNING_CERT_SHA256', '--repo', repository], { input: publicInfo.sha256 });
  console.log('Four signing secrets and the public certificate fingerprint configured in GitHub.');
}
if (mode === 'build') {
  run('npm', ['run', 'cap:sync'], { stdio: 'inherit' });
  const result = spawnSync('./gradlew', [':app:assembleDebug'], { cwd: join(root, 'android'), stdio: 'inherit', env: {
    ...process.env, BUNBLOCKS_KEYSTORE_FILE: keystore, BUNBLOCKS_KEYSTORE_PASSWORD: identity.password,
    BUNBLOCKS_KEY_ALIAS: identity.alias, BUNBLOCKS_KEY_PASSWORD: identity.password,
  } });
  if (result.status !== 0) throw new Error('Signed Android build failed.');
}
console.log(JSON.stringify(publicInfo, null, 2));
