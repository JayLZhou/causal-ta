import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title:'CausalTA — Your Personal TA',
 description:'上传任何学科的课程材料，找到卡住的原因，用独立复测留下学习证据。你的因果驱动个人 TA。',
 icons:{icon:'/favicon.svg'},
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
 return <html lang="zh-CN"><body>{children}</body></html>;
}
