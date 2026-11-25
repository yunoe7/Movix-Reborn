import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import ConfirmDialog from '../ui/confirm-dialog';

export interface AdminConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface AdminConfirmContextValue {
  confirm: (options: AdminConfirmOptions) => Promise<boolean>;
}

const AdminConfirmContext = createContext<AdminConfirmContextValue | null>(null);

export const AdminConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [options, setOptions] = useState<AdminConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((next: AdminConfirmOptions) => {
    if (resolver.current) resolver.current(false);
    resolver.current = null;
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <AdminConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog
        isOpen={options !== null}
        title={options?.title ?? ''}
        message={options?.message ?? ''}
        confirmLabel={options?.confirmLabel}
        cancelLabel={options?.cancelLabel}
        variant={options?.destructive ? 'destructive' : 'default'}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </AdminConfirmContext.Provider>
  );
};

export function useAdminConfirm(): AdminConfirmContextValue {
  const context = useContext(AdminConfirmContext);
  if (!context) {
    throw new Error('useAdminConfirm must be used inside AdminConfirmProvider');
  }
  return context;
}
