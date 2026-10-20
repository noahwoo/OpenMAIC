'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
export default function MiniappLaunch() {
  const { t } = useI18n();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/miniapp');
    async function connect() {
      if (!token) throw new Error('Missing launch ticket');
      const response = await fetch('/miniapp/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Launch expired');
      const { href } = await response.json();
      window.location.replace(href);
    }
    void connect().catch(() => setFailed(true));
  }, []);
  return (
    <main className="p-6 text-center" role="status">
      {t(failed ? 'miniapp.launchFailed' : 'miniapp.connecting')}
    </main>
  );
}
