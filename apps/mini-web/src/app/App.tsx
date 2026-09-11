import { Compass, Film, Library, Search, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import styles from './App.module.css';
import { t } from '../lib/i18n';
import { useLocale } from '../lib/storage';
import { componentIsEnabled, useUiComponents } from '../features/cms/ui-components';

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Compass }) {
  return <NavLink to={to} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}>{({ isActive }) => <><Icon size={19} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden="true" /><span>{label}</span></>}</NavLink>;
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const isWatchPage = location.pathname.startsWith('/watch/');
  const components = useUiComponents();
  const ui = components.data?.items;

  return <div className={styles.appShell}>
    {componentIsEnabled(ui, 'APP_TOPBAR') && <header className={styles.topbar}>
      <button className={styles.brandButton} onClick={() => navigate('/')} aria-label="QuicK ReeLS home">
        <span className={styles.brandMark}><Film size={18} aria-hidden="true" /></span>
        <span>QuicK <span>ReeLS</span></span>
      </button>
      <div className={styles.topbarActions}>
        <button className={styles.topIcon} onClick={() => navigate('/search')} aria-label={t(locale, 'search')} title={t(locale, 'search')}><Search size={19} aria-hidden="true" /></button>
        <button className={styles.profileButton} onClick={() => navigate('/profile')} aria-label={t(locale, 'profile')}><UserRound size={18} aria-hidden="true" /></button>
      </div>
    </header>}
    <main className={`${styles.main} ${isWatchPage ? styles.watchMain : ''}`}><Outlet /></main>
    {!isWatchPage && componentIsEnabled(ui, 'APP_BOTTOM_NAV') && <nav className={styles.bottomNav} aria-label={t(locale, 'navigation')}>
      <NavItem to="/" label={t(locale, 'home')} icon={Compass} />
      <NavItem to="/search" label={t(locale, 'search')} icon={Search} />
      <NavItem to="/profile" label={t(locale, 'library')} icon={Library} />
    </nav>}
  </div>;
}
