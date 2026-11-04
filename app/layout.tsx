import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Keystone Sales Operating System',description:'B2B order execution, delivery and collections'};
export default function Layout({children}:{children:React.ReactNode}) {
 return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
