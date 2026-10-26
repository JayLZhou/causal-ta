'use client';
import {useState} from 'react';
import {validateText,pageRange,pageText} from '@/lib/document-text.mjs';
export default function MaterialImport({onImport,busy}:{onImport:(text:string,title:string)=>void;busy:boolean}) {
 const [file,setFile]=useState<File|null>(null),[from,setFrom]=useState(1),[to,setTo]=useState(1),[preview,setPreview]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function extract() {
  if(!file)return;setError('');setPreview('');setLoading(true);
  try {
   if(file.size>10*1024*1024)throw Error('文件不能超过 10MB。');
   let content='';
   if(/\.pdf$/i.test(file.name)) {
    const pdfjs=await import('pdfjs-dist');
    const assetBase='/generated/pdfjs-'+pdfjs.version+'/';
    pdfjs.GlobalWorkerOptions.workerSrc=assetBase+'pdf.worker.min.mjs';
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),disableFontFace:true,useSystemFonts:false,useWorkerFetch:true,standardFontDataUrl:assetBase+'standard_fonts/',cMapUrl:assetBase+'cmaps/',cMapPacked:true,wasmUrl:assetBase+'wasm/'});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
     content=await Promise.race([(async()=>{const pdf=await task.promise;const sections=[];let count=0;for(const n of pageRange(from,to,pdf.numPages)){const page=await pdf.getPage(n);const raw=pageText((await page.getTextContent()).items);if(!raw)throw Error(`第 ${n} 页没有文本，可能是扫描件；请先做 OCR。`);const text=`[第 ${n} 页]\n${raw}`;count+=text.length+2;if(count>20000)throw Error('提取内容超过 20,000 字，请缩小页码范围。');sections.push(text);page.cleanup();}return sections.join('\n\n');})(),new Promise<string>((_,reject)=>{timer=setTimeout(()=>reject(Error('PDF 提取超时，请缩小文件或页码范围。')),20000);})]);
    }finally{if(timer)clearTimeout(timer);await task.destroy();}
   } else {
    if(!/\.(txt|md)$/i.test(file.name))throw Error('支持 PDF、TXT 和 Markdown 文件。');
    if(file.size>80000)throw Error('文本文件过大，请拆分为 20,000 字以内。');
    content=await file.text();
   }
   setPreview(validateText(content));
  }catch(e){setError(e instanceof Error?e.message:'读取失败，请尝试文本文件。');}finally{setLoading(false);}
 }
 return <details className="material-import"><summary>导入 PDF / TXT / Markdown</summary><p className="muted">在你的浏览器内提取，不上传原文件。PDF 保留页码；公式、表格的顺序可能变化，请核对预览。暂不支持扫描件 OCR。</p><label>选择文件<input type="file" accept=".pdf,.txt,.md" disabled={busy||loading} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview('');setError('');}}/></label>{file&&/\.pdf$/i.test(file.name)&&<div className="variable-grid"><label>起始页<input type="number" min={1} value={from} disabled={loading} onChange={e=>setFrom(Number(e.target.value))}/></label><label>结束页（最多 20 页）<input type="number" min={from} value={to} disabled={loading} onChange={e=>setTo(Number(e.target.value))}/></label></div>}<button type="button" className="button secondary" disabled={!file||busy||loading} onClick={()=>void extract()}>{loading?'正在提取…':'提取并预览'}</button>{error&&<p className="alert error" role="alert">{error}</p>}{preview&&<><label>核对提取结果<textarea rows={8} maxLength={20000} value={preview} onChange={e=>setPreview(e.target.value)}/></label><button type="button" className="button secondary" disabled={busy||loading||!preview.trim()} onClick={()=>{onImport(preview,file!.name.replace(/\.[^.]+$/,'').slice(0,120));setPreview('');}}>用预览文本替换正文（保存后生效）</button></>}</details>;
}
