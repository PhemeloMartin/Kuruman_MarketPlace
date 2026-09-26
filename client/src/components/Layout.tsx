import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useCart } from '../cart/CartContext'
import { LANGUAGES, currentLanguage, setLanguage } from '../lib/translate'
import type { LanguageCode } from '../lib/translate'
import { useOnline } from '../lib/useOnline'
import { useUnread } from '../notifications/UnreadContext'
import { DuneRibbon, LogoMark } from './Art'
import { BellIcon, CartIcon, HomeIcon, OrdersIcon, ProfileIcon, ShieldIcon, ShopIcon, TruckIcon } from './Icons'

export function Layout() {
  const online = useOnline()
  return (
    <div className="app">
      <DuneRibbon />
      {!online && (
        <p className="offline-banner" role="status">
          You’re offline. You can browse saved products and fill your cart. Orders, payments and deliveries need a
          connection.
        </p>
      )}
      <Outlet />
      <BottomNav />
    </div>
  )
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link to="/" className="brand" aria-label="KurumanMarketPlace home">
        <LogoMark />
        <span>
          <span className="brand-name" translate="no">
            KurumanMarketPlace
          </span>
          <br />
          <span className="brand-tagline">The oasis of the Kalahari, online</span>
        </span>
      </Link>
      <div className="header-actions">
        <NotificationBell />
        <LanguageSelect />
      </div>
    </header>
  )
}

function NotificationBell() {
  const { user } = useAuth()
  const { unread } = useUnread()
  if (!user || user.role === 'support') return null
  return (
    <Link to="/notifications" className="bell" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
      <BellIcon />
      {unread > 0 && (
        <span className="nav-badge" aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  )
}

function LanguageSelect() {
  return (
    <>
      <label htmlFor="language" className="visually-hidden">
        Language
      </label>
      <select
        id="language"
        className="lang-select notranslate"
        translate="no"
        value={currentLanguage()}
        onChange={(e) => setLanguage(e.target.value as LanguageCode)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} title={l.name}>
            {l.label}
          </option>
        ))}
      </select>
    </>
  )
}

function BottomNav() {
  const { itemCount } = useCart()
  const { user } = useAuth()
  const { unread } = useUnread()
  const isSeller = user?.role === 'entrepreneur'
  const isCourier = user?.role === 'courier'
  // Support staff don't shop: they get the catalogue (to check listings), the console and their profile.
  if (user?.role === 'support') {
    return (
      <nav className="bottom-nav three" aria-label="Main">
        <NavLink to="/" end>
          <HomeIcon />
          Home
        </NavLink>
        <NavLink to="/support">
          <ShieldIcon />
          Console
        </NavLink>
        <NavLink to="/profile">
          <ProfileIcon />
          Profile
        </NavLink>
      </nav>
    )
  }
  return (
    <nav className={`bottom-nav${isSeller || isCourier ? ' five' : ''}`} aria-label="Main">
      <NavLink to="/" end>
        <HomeIcon />
        Home
      </NavLink>
      <NavLink to="/cart" aria-label={itemCount ? `Cart, ${itemCount} items` : 'Cart'}>
        <CartIcon />
        Cart
        {itemCount > 0 && (
          <span className="nav-badge" aria-hidden="true">
            {itemCount}
          </span>
        )}
      </NavLink>
      {isSeller && (
        <NavLink to="/seller">
          <ShopIcon />
          My shop
        </NavLink>
      )}
      {isCourier && (
        <NavLink to="/courier">
          <TruckIcon />
          Jobs
        </NavLink>
      )}
      <NavLink to="/orders">
        <OrdersIcon />
        Orders
      </NavLink>
      <NavLink to="/profile" aria-label={unread ? `Profile, ${unread} new notifications` : 'Profile'}>
        <ProfileIcon />
        Profile
        {unread > 0 && (
          <span className="nav-badge" aria-hidden="true">
            {unread}
          </span>
        )}
      </NavLink>
    </nav>
  )
}
