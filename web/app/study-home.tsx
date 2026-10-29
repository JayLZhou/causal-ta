'use client';
import {useState,useEffect,useRef,type ReactNode} from 'react';
import {ArrowRight,ArrowUpRight,BookOpen,Upload,Plus,FileText,Check,RotateCcw,GitBranch,Brain,Quote} from 'lucide-react';

type Course={id:string;title:string;subject:string;goal:string};
const cases=[
 {subject:'数学',tag:'微积分 · 乘积求导',quote:'导数公式背过了，为什么一做题就错？',question:'先看一个小问题：x · x 的导数是？',options:['1','2x'],correct:1,causes:['把乘积当成分别求导','简单题会做，需回查原题'],hint:['把 x · x 先写成 x²，导数就是 2x。两部分都在变化，因此要用 u′v + uv′，不能只算 u′v′。','这说明你在这个简单例子里能正确求导。下一步回到原题，逐行核对计算；还不能据此确定错误原因。'],next:'换个表达式：x · x² 的导数是？',answers:['2x','3x²'],right:1,explain:'x · x² = x³，所以导数为 3x²；也可以用乘积法则得到 x² + 2x²。'},
 {subject:'编程',tag:'Python · 列表与引用',quote:'我只改了 b，为什么 a 也跟着变了？',question:'a = [1]; b = a; b.append(2)\na 现在是什么？',options:['[1]','[1, 2]'],correct:1,causes:['把赋值理解成复制列表','知道共享引用，需要检查修改位置'],hint:['b = a 让两个名字指向同一个列表。沿着两个名字找到的，都是被 append 修改的那个对象。','你已经识别出共享引用。回到原程序，标出每一次原地修改，再决定哪里需要创建新列表。'],next:'若改成 b = a.copy()，再执行 b.append(2)，a 是什么？',answers:['[1]','[1, 2]'],right:0,explain:'这里是只含整数的列表。copy() 创建新列表，所以向 b 追加元素不会改变 a。'},
 {subject:'历史',tag:'史料分析 · 因果解释',quote:'两件事先后发生，就能说前者导致后者吗？',question:'粮价上涨后发生抗议，仅凭这个顺序能确定因果吗？',options:['能，先发生的就是原因','不能，还需要其他证据'],correct:1,causes:['把时间先后当成因果证据','已区分先后关系，需要比较解释'],hint:['先后顺序是线索。还要检查战争、政策等共同因素，并结合不同史料判断替代解释。','你已注意到替代解释。接下来比较不同地区、不同时间的记录，寻找哪些证据支持或削弱某个解释。'],next:'哪类新增证据更有助于区分“粮价”与“战争”两种解释？',answers:['再引用一次同样的事件顺序','比较粮价与战争影响不同的地区'],right:1,explain:'地区间的对比可能帮助区分解释，但仍需检查其他差异和史料偏差，不能自动确定因果。'}
];
function CausalDemo(){
 const [topic,setTopic]=useState(0),[choice,setChoice]=useState<number|null>(null),[step,setStep]=useState(0),[answer,setAnswer]=useState<number|null>(null);
 const promptHeading=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(step>0)promptHeading.current?.focus();},[step]);
 const c=cases[topic],branch=choice===null?null:choice===c.correct?1:0;
 function reset(i=topic){setTopic(i);setChoice(null);setAnswer(null);setStep(0);}
 return <section className="causal-demo" aria-label="因果辅导互动演示">
  <div className="demo-topline"><span><span className="live-dot"/>因果式辅导，试一次</span><span>预设演示 · 不调用 AI</span></div>
  <div className="demo-subjects" aria-label="选择演示学科">{cases.map((v,i)=><button key={v.subject} aria-pressed={topic===i} onClick={()=>reset(i)}>{v.subject}</button>)}<span>不限于这些学科 <ArrowUpRight size={12}/></span></div>
  <div className="demo-notebook"><div className="demo-topic"><span>{c.tag}</span><Quote size={18}/></div><h2>“{c.quote}”</h2>
   <div className="reason-map"><div className="reason-origin"><GitBranch size={14}/>同一个卡点，可能有不同原因</div><div className="reason-forks">{c.causes.map((cause,i)=><div key={cause} className={'reason-node '+(branch===i?'active':branch!==null?'dim':'')}><small>{branch===i?'优先验证':'假设 '+String.fromCharCode(65+i)}</small><span>{cause}</span></div>)}</div></div>
   <div className="demo-interaction" aria-live="polite"><div className="demo-ta" ref={promptHeading} tabIndex={-1} role="heading" aria-level={3}><span className="mini-ta">∴</span><b>{step===0?'先用一个问题，缩小范围':step===1?'根据你的回答，换一种帮助':'换一道题，看看能不能独立完成'}</b><span>{step+1} / 3</span></div>
    {step===0?<><p className="demo-question">{c.question}</p><div className="demo-answers">{c.options.map((o,i)=><button key={o} onClick={()=>{setChoice(i);setStep(1);}}><span>{String.fromCharCode(65+i)}</span>{o}<ArrowRight size={15}/></button>)}</div></>:step===1?<><p className="demo-answer-echo">你的回答：{c.options[choice!]}</p><p className="demo-question">{c.hint[branch!]}</p><button className="demo-next" onClick={()=>setStep(2)}>收起提示，独立试一题 <ArrowRight size={15}/></button></>:<><p className="demo-question">{c.next}</p>{answer===null?<div className="demo-answers">{c.answers.map((a,i)=><button key={a} onClick={()=>setAnswer(i)}><span>{String.fromCharCode(65+i)}</span>{a}<ArrowRight size={15}/></button>)}</div>:<div className="demo-result"><b>{answer===c.right?<><Check size={15}/>这道题答对了</>:'还需要再看一个例子'}</b><p>{c.explain}</p><div className="demo-memory"><Brain size={16}/><span>可留下的学习记录：{answer===c.right?'本次换题作答正确，之后再复测。':'本次换题仍有困难，下次继续检查。'}<small>本演示不写入你的记忆，也不代表已经掌握。</small></span></div></div>}</>}
   </div>
  </div>
  <div className="demo-bottom"><span>找原因 → 针对性帮助 → 换题验证</span><button aria-label="重新体验当前示例" onClick={()=>reset()}><RotateCcw size={13}/>重试</button></div>
 </section>;
}
export default function StudyHome({user,courses,loading,creating,form,onCreate,onOpen}:{user:{name:string}|null;courses:Course[];loading:boolean;creating:boolean;form:ReactNode;onCreate:(upload:boolean)=>void;onOpen:(id:string)=>void}){
 return <div className="learning-home">
  <div className="home-intro"><span className="home-eyebrow"><span/> YOUR PERSONAL TA</span><span className="home-edition">为每一个「为什么」留一点时间</span></div>
  <div className="learning-entry"><section className="entry-copy"><div className="entry-caption">有答案之后，学习才刚刚开始。</div><h1>从「看懂了」，<br/>到<span>「我会了」。<svg viewBox="0 0 280 12" aria-hidden="true"><path d="M3 8 Q130 -2 276 5"/></svg></span></h1><p className="entry-description">带上你的课件和问题。TA 帮你找出卡住的原因，<br className="desktop-break"/>给恰好的提示，再让你独立试一次。</p>
   <div className="entry-upload">{creating?form:<><div className="paper-stack" aria-hidden="true"><span className="paper-back"/><span className="paper-front"><FileText size={24}/><i/><i/><i/></span><span className="paper-plus"><Plus size={15}/></span></div><h2>今天，想弄懂什么？</h2><p>一本教材、一份讲义，或一道没做出的题。</p>{user?<button className="button entry-primary" onClick={()=>onCreate(true)}><Upload size={17}/>上传资料，开始学习 <ArrowUpRight size={17}/></button>:<a className="button entry-primary" href="/signin-with-chatgpt?return_to=%2F%23home" target="_top"><Upload size={17}/>登录后上传资料 <ArrowUpRight size={17}/></a>}<span className="upload-formats">PDF · Word · 图片 · 文本</span><div className="entry-no-file"><span>手边没有资料？</span>{user?<button onClick={()=>onCreate(false)}>直接创建课程 <ArrowRight size={13}/></button>:<span>右侧示例无需登录</span>}</div></>}</div>
   <div className="entry-footnote"><span>任何学科</span><i/>资料可追溯<i/>学习记忆可编辑</div>
  </section><CausalDemo/></div>
  <section className="home-library" aria-label="我的课程"><div className="library-title"><div><span className="section-index">你的学习书架</span><h2>接着上次的思路。</h2></div>{user&&<button className="text-button" onClick={()=>onCreate(false)}><Plus size={15}/>新建课程</button>}</div>{loading?<p className="library-loading">正在打开课程…</p>:courses.length?<div className="notebook-grid">{courses.map((c,i)=><button className={'course-notebook notebook-'+i%3} key={c.id} onClick={()=>onOpen(c.id)}><div className="notebook-spine"/><div className="notebook-info"><span className="notebook-subject">{c.subject||'自主学习'}</span><h3>{c.title}</h3><p>{c.goal||'从资料、问题和上次的尝试继续。'}</p><span className="notebook-open">打开课程 <ArrowUpRight size={16}/></span></div><BookOpen className="notebook-symbol" size={48}/></button>)}</div>:<div className="library-empty"><BookOpen size={24}/><div><b>还没有课程，留一个位置给你的好奇心。</b><p>创建后，资料、对话和学习记录都会收在这里。</p></div></div>}</section>
 </div>;
}
