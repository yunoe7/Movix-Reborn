import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useVipModal } from '../context/VipModalContext';
import './vip-access-modal.css';

type SubmitStatus = 'idle' | 'loading' | 'success';

const SUCCESS_CLOSE_DELAY_MS = 900;

/**
 * Formulaire d'activation d'une clé VIP. La validation reste intégralement
 * déléguée à `checkAccessCode` (API + expiration + limitation des tentatives) :
 * ici on ne gère que l'interface et les événements applicatifs post-succès.
 */
const AccessCodeForm: React.FC = () => {
  const { t } = useTranslation();
  const { checkAccessCode, error } = useAuth();
  const { closeVipModal } = useVipModal();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAuthError, setShowAuthError] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
    }
  }, []);

  const visibleError = localError || (showAuthError && error ? error : null);
  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || isSuccess) return;

    setLocalError(null);
    setShowAuthError(false);
    setStatus('loading');

    const alreadyAuthenticated = localStorage.getItem('discord_auth') === 'true'
      || localStorage.getItem('google_auth') === 'true';

    try {
      const success = await checkAccessCode(code, alreadyAuthenticated);
      if (!success) {
        setShowAuthError(true);
        setStatus('idle');
        return;
      }

      // Conserver exactement les effets applicatifs de l'ancien formulaire.
      localStorage.setItem('is_vip', 'true');
      if (!localStorage.getItem('guest_uuid')) {
        const tempUuid = `vip_${Math.random().toString(36).substring(2, 15)}`;
        localStorage.setItem('guest_uuid', tempUuid);
      }
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new CustomEvent('authStateChanged'));

      setStatus('success');
      closeTimer.current = window.setTimeout(() => {
        closeVipModal();
      }, SUCCESS_CLOSE_DELAY_MS);
    } catch (submitError) {
      console.error('Error checking access code:', submitError);
      setLocalError(t('vip.activationError'));
      setStatus('idle');
    }
  };

  return (
    <form className="vip-access-modal-form" onSubmit={handleSubmit} noValidate={false}>
      <div>
        <label className="vip-access-modal-label" htmlFor="vip-access-code">
          {t('vip.accessModal.codeLabel')}
        </label>
        <div className="vip-access-modal-input-wrap">
          <span className="vip-access-modal-input-icon" data-vip-icon="vip-modal-input" aria-hidden="true">
            <KeyRound className="h-[18px] w-[18px]" />
          </span>
          <input
            id="vip-access-code"
            data-testid="vip-access-code"
            className="vip-access-modal-input"
            type="text"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setLocalError(null);
              setShowAuthError(false);
            }}
            placeholder={t('vip.accessModal.codePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            required
            disabled={isLoading || isSuccess}
            aria-invalid={visibleError ? true : undefined}
            aria-describedby={visibleError ? 'vip-access-message' : undefined}
          />
        </div>
      </div>

      {visibleError && (
        <p
          id="vip-access-message"
          data-testid="vip-access-error"
          className="vip-access-modal-note"
          role="alert"
        >
          <span className="inline-flex" data-vip-icon="vip-modal-error" aria-hidden="true">
            <AlertCircle className="h-4 w-4" />
          </span>
          <span>{visibleError}</span>
        </p>
      )}

      {isSuccess && (
        <p
          id="vip-access-message"
          data-testid="vip-access-success"
          className="vip-access-modal-note vip-access-modal-note--success"
          role="status"
        >
          <span className="inline-flex" data-vip-icon="vip-modal-success" aria-hidden="true">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <span>{t('vip.accessModal.success')}</span>
        </p>
      )}

      <button
        type="submit"
        data-testid="vip-access-submit"
        className="vip-access-modal-submit"
        disabled={isLoading || isSuccess}
        aria-busy={isLoading ? true : undefined}
      >
        {isLoading ? (
          <>
            <span className="inline-flex" data-vip-icon="vip-modal-loading" aria-hidden="true">
              <Loader2 className="vip-access-modal-spinner h-[18px] w-[18px]" />
            </span>
            <span>{t('vip.accessModal.submitting')}</span>
          </>
        ) : isSuccess ? (
          <>
            <span className="inline-flex" aria-hidden="true">
              <CheckCircle2 className="h-[18px] w-[18px]" />
            </span>
            <span>{t('vip.accessModal.success')}</span>
          </>
        ) : (
          <>
            <span className="inline-flex" aria-hidden="true">
              <KeyRound className="h-[18px] w-[18px]" />
            </span>
            <span>{t('vip.accessModal.submit')}</span>
          </>
        )}
      </button>
    </form>
  );
};

export default AccessCodeForm;
