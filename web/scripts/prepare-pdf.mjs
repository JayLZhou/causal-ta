// Public files are served verbatim: a PDF worker must never receive page HMR code.
import {readFileSync,mkdirSync,copyFileSync,cpSync} from 'node:fs';
import path from 'node:path';
const pkg=path.resolve('node_modules/pdfjs-dist'),version=JSON.parse(readFileSync(path.join(pkg,'package.json'),'utf8')).version;
const target=path.resolve('public/generated/pdfjs-'+version);mkdirSync(target,{recursive:true});
copyFileSync(path.join(pkg,'build/pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs'));
copyFileSync(path.join(pkg,'LICENSE'),path.join(target,'LICENSE'));
for(const folder of ['cmaps','standard_fonts','wasm'])cpSync(path.join(pkg,folder),path.join(target,folder),{recursive:true});
