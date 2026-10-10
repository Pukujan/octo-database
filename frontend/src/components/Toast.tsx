import { useEffect, useState } from 'react';
import { TOAST_EVENT, type ToastDetail } from '@/utils/toast';

/** Renders the most recent notice in the legacy `.toast` element, auto-dismissing. */
export function Toast() {
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let timer: number | undefined;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      setNotice(detail.message);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotice(''), 4000);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.clearTimeout(timer);
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="toast" role="status">
      {notice}
    </div>
  );
}
