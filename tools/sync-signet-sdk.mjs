import {createRequire} from 'node:module';
import {copyFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const source=require.resolve('signet-login/iife');
const targets=['signet-login.iife.js','signet-login-0.17.3.iife.js'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const expected=hash(readFileSync(source));
for(const name of targets){
  const target=new URL('../public/signet/'+name,import.meta.url);
  if(!existsSync(target)||hash(readFileSync(target))!==expected){
    if(process.argv.includes('--check'))throw new Error('Signet bundle differs from the lockfile; run npm run sync:sdk and commit the result');
    copyFileSync(source,target);
  }
}
console.log('Both Signet Login paths match the locked package.');
