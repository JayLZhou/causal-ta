import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title:'CausalTA — Your Personal TA',
 description:'用预测、实验和证据理解计算机与数学。你的因果驱动个人 TA。',
 icons:{icon:'/favicon.svg'},
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
 return <html lang="zh-CN"><body>{children}</body></html>;
}
