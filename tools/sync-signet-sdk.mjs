import {createRequire} from 'node:module';
import {copyFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const source=require.resolve('signet-login/iife');
const target=new URL('../public/signet/signet-login.iife.js',import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
const expected=readFileSync(source);
const current=readFileSync(target);
if(hash(expected)!==hash(current)){
  if(process.argv.includes('--check'))throw new Error('Signet bundle differs from the lockfile; run npm run sync:sdk and commit the result');
  copyFileSync(source,target);
}
console.log('Signet Login bundle matches the locked package.');
