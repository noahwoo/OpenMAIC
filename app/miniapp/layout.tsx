import type { Metadata } from 'next';
import './mobile.css';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function MiniappLayout({ children }: { children: React.ReactNode }) {
  return children;
}
