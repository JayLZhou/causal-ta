export function validateText(text) {
 if(typeof text!=='string'||!text.trim())throw Error('没有可导入的文本。扫描件需要先做 OCR，再导入文字。');
 if(text.includes('\u0000')||text.includes('\ufffd'))throw Error('文件不是有效的 UTF-8 文本，请先转换编码。');
 if(text.length>20000)throw Error('所选内容超过 20,000 字，请缩小 PDF 页码范围或拆分文本文件。');
 return text;
}
export function pageRange(from,to,total) {
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>total||to-from>=20)throw Error(`页码无效：共 ${total} 页，每次最多提取 20 页。`);
 return Array.from({length:to-from+1},(_,i)=>from+i);
}
export function pageText(items) {return items.filter(i=>typeof i.str==='string').map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();}
