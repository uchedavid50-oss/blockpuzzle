// Keep the iOS callback scheme and the Vite public client ID in the same build configuration.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const id = (process.env.VITE_GOOGLE_IOS_CLIENT_ID ?? '').trim();
if (id && !/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('Invalid VITE_GOOGLE_IOS_CLIENT_ID');
const script = `
import plistlib,sys
path,client=sys.argv[1:]
with open(path,'rb') as f: original=plistlib.load(f)
data=dict(original)
entries=[v for v in data.get('CFBundleURLTypes',[]) if v.get('CFBundleURLName')!='app.bunblocks.google']
if client:
 entries.append({'CFBundleURLName':'app.bunblocks.google','CFBundleURLSchemes':['.'.join(reversed(client.split('.')))]})
 data['GIDClientID']=client
else: data.pop('GIDClientID',None)
if entries: data['CFBundleURLTypes']=entries
else: data.pop('CFBundleURLTypes',None)
if data!=original:
 with open(path,'wb') as f: plistlib.dump(data,f,sort_keys=False)
`;
const result = spawnSync('python3', ['-c', script, resolve(import.meta.dirname, '../ios/App/App/Info.plist'), id], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('iOS Google callback configuration failed');
