import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=new URL('../dist/',import.meta.url);
const files={};
async function walk(path=''){
 for(const entry of await readdir(new URL(path,root),{withFileTypes:true})){
  const name=join(path,entry.name);
  if(entry.isDirectory())await walk(name+'/');
  else if(entry.isFile())files[name]=createHash('sha256').update(await readFile(new URL(name,root))).digest('hex');
  else throw new Error('Unexpected non-regular client entry');
 }
}
await walk();
const version=JSON.parse(await readFile(new URL('version.json',root),'utf8'));
await writeFile('neon-client-manifest.json',JSON.stringify({revision:version.revision,version,files},null,2)+'\n');
console.log(JSON.stringify({revision:version.revision,checkedFiles:Object.keys(files).length}));
