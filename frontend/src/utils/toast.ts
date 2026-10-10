// Notices surface as the legacy `.toast` element rather than a library overlay,
// so the same markup styles both the app's own notices and these call-site
// helpers. A plain event keeps the many call sites unchanged.

export const TOAST_EVENT = 'octo-toast';

export interface ToastDetail {
  kind: 'success' | 'error' | 'loading';
  message: string;
}

export function notify(kind: ToastDetail['kind'], message: string): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { kind, message } }));
}

export const showSuccess = (message: string) => notify('success', message);
export const showError = (message: string) => notify('error', message);
export const showLoading = (message: string) => {
  notify('loading', message);
  return '';
};
export const dismissToast = (_id: string) => undefined;
