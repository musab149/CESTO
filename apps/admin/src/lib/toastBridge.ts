/**
 * A way to raise a toast from code that is not a component.
 *
 * main.tsx decides what happens to a failed request, and it runs outside the
 * tree — it cannot call useToast(). Before this existed its only two options
 * were a console line nobody is watching and a full page load to /500, so one
 * failed BACKGROUND refetch threw away whatever the admin was doing.
 *
 * Its own module rather than a second export from Toast.tsx, because that file
 * exports components and react-refresh wants it to export only components.
 */
export interface BridgedToast {
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}

let emit: ((toast: BridgedToast) => void) | null = null;

/**
 * Called by ToastProvider while it is mounted. Returns the un-register, so a
 * stale closure cannot outlive the provider that owns it.
 */
export function registerToastEmitter(fn: (toast: BridgedToast) => void): () => void {
  emit = fn;
  return () => { if (emit === fn) emit = null; };
}

/**
 * Show a toast from outside React.
 *
 * Returns false when no provider is mounted to show it, so the caller can fall
 * back to something louder rather than swallow the message.
 */
export function notifyOutsideReact(toast: BridgedToast): boolean {
  if (!emit) return false;
  emit(toast);
  return true;
}
