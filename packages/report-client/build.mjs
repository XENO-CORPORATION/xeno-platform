import * as esbuild from 'esbuild';
import ts from 'typescript';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url)), source=path.join(root,'src');
await mkdir(path.join(root,'dist'),{recursive:true});
const pending=[];
const program=ts.createProgram([path.join(source,'index.ts'),path.join(source,'redaction.ts')],{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  strict:true,skipLibCheck:true,declaration:true,emitDeclarationOnly:true,noEmitOnError:true,
});
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
  getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n',
}));
program.emit(undefined,(_file,data,_bom,_error,files)=>{
  const own=files?.find(f=>path.resolve(f.fileName).startsWith(source+path.sep));
  if(own) pending.push(writeFile(path.join(root,'dist',path.relative(source,own.fileName).replace(/\.ts$/,'.d.ts')),data));
});
await Promise.all(pending);
await esbuild.build({entryPoints:[path.join(source,'index.ts')],outfile:path.join(root,'dist/index.js'),
  bundle:true,format:'esm',platform:'neutral',target:'es2022',sourcemap:false});
