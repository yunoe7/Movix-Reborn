import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { DISCORD_INVITE_URL } from '@/config/community';
import './Footer.css';

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer data-site-footer className="site-footer">
      <div className="site-footer__inner">
        <nav aria-label={t('footer.navigation')} className="site-footer__links">
          <Link to="/about">Aide</Link>
          <Link to="/terms-of-service">{t('auth.termsOfService')}</Link>
          <Link to="/privacy">{t('nav.privacy')}</Link>
          <a href="https://github.com/movixstream/MovixOpenSource" target="_blank" rel="noopener noreferrer">{t('footer.sourceCode')}</a>
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">{t('footer.discord')}</a>
          <Link to="/frais">{t('costs.navLabel')}</Link>
          <a href="https://movix.online" target="_blank" rel="noopener noreferrer">{t('footer.ourUrls')}</a>
        </nav>

        <p className="site-footer__disclaimer">{t('footer.contentText')}</p>

        <div className="site-footer__bottom">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </div>

      <button
        type="button"
        className="site-footer__back-to-top"
        aria-label={t('footer.backToTop', 'Retour en haut')}
        title={t('footer.backToTop', 'Retour en haut')}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <span aria-hidden="true">↑</span>
      </button>
    </footer>
  );
};

export default Footer;
