import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useCart } from '../cart/CartContext'
import { LANGUAGES, currentLanguage, setLanguage } from '../lib/translate'
import type { LanguageCode } from '../lib/translate'
import { useOnline } from '../lib/useOnline'
import { useUnread } from '../notifications/UnreadContext'
import { api } from '../lib/api'
import { DuneRibbon, LogoMark } from './Art'
import { TermsGate } from './TermsGate'
import { BellIcon, CartIcon, CloseIcon, HomeIcon, MenuIcon, OrdersIcon, ProfileIcon, ShieldIcon, ShopIcon, TruckIcon } from './Icons'

// Every page: the header (menu, name, cart, language), the page itself, and the footer with the
// terms, help and refunds links.
export function Layout() {
  const online = useOnline()
  const location = useLocation()
  // Home may spread out on a laptop screen; every other page stays phone-width.
  const wide = location.pathname === '/'

  // In Setswana or Afrikaans, Google's translator (lib/translate.ts) translates a page well when it loads,
  // but often misses text the app swaps in afterwards. So there, going to another page loads it afresh and
  // the translator sees all of it. English is unaffected. (The address is compared, not "first render",
  // because React runs this twice in development.)
  const shownAddress = useRef(location.pathname + location.search)
  useEffect(() => {
    const address = location.pathname + location.search
    if (address === shownAddress.current) return
    shownAddress.current = address
    if (currentLanguage() !== 'en') window.location.reload()
  }, [location.pathname, location.search])
  return (
    <div className={wide ? 'app app-wide' : 'app'}>
      <DuneRibbon />
      <SiteHeader />
      {!online && (
        <p className="offline-banner" role="status">
          You’re offline. You can browse saved products and fill your cart. Orders, payments and deliveries need a
          connection.
        </p>
      )}
      <Outlet />
      <SiteFooter />
      <TermsGate />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="site-header">
      <MainMenu />
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
        <CartLink />
        <LanguageSelect />
      </div>
    </header>
  )
}

// The ☰ button (top left) opens the menu as a panel from the left. It's a <dialog>: the browser keeps the
// keyboard inside it while it's open, and Escape or a tap next to it closes it.
function MainMenu() {
  const { user } = useAuth()
  const { itemCount } = useCart()
  const { unread } = useUnread()
  const menu = useRef<HTMLDialogElement>(null)
  const location = useLocation()
  const close = () => menu.current?.close()

  // Following a link in the menu changes the page: close the menu then.
  useEffect(() => {
    menu.current?.close()
  }, [location])

  const role = user?.role
  const shops = role !== 'support' // support staff check listings, they don't shop

  return (
    <>
      <button
        type="button"
        className="menu-button"
        aria-haspopup="dialog"
        aria-label={unread ? `Menu, ${unread} new notifications` : 'Menu'}
        onClick={() => menu.current?.showModal()}
      >
        <MenuIcon />
        {unread > 0 && <span className="nav-badge" aria-hidden="true" />}
      </button>
      <dialog
        ref={menu}
        className="menu-drawer"
        aria-label="Menu"
        onClick={(e) => e.target === e.currentTarget && close()} // a tap on the dimmed page beside the menu
      >
        <div className="menu-panel">
          <div className="menu-head">
            <span className="brand-name" translate="no">
              KurumanMarketPlace
            </span>
            <button type="button" className="menu-close" aria-label="Close the menu" onClick={close}>
              <CloseIcon />
            </button>
          </div>

          {user ? (
            <p className="menu-hello">Hello, {user.displayName}</p>
          ) : (
            <Link to="/signin" className="btn btn-primary btn-block">
              Sign in or join
            </Link>
          )}

          <nav className="menu-links" aria-label="Main">
            <NavLink to="/" end>
              <HomeIcon /> Home
            </NavLink>
            {shops && (
              <NavLink to="/cart">
                <CartIcon /> Cart
                {itemCount > 0 && <span className="menu-count">{itemCount}</span>}
              </NavLink>
            )}
            {user && shops && (
              <NavLink to="/orders">
                <OrdersIcon /> My orders
              </NavLink>
            )}
            {role === 'entrepreneur' && (
              <NavLink to="/seller">
                <ShopIcon /> My shop
              </NavLink>
            )}
            {role === 'courier' && (
              <NavLink to="/courier">
                <TruckIcon /> Deliveries
              </NavLink>
            )}
            {role === 'support' && (
              <NavLink to="/support">
                <ShieldIcon /> Support console
              </NavLink>
            )}
            {user && role !== 'support' && (
              <NavLink to="/notifications">
                <BellIcon /> Notifications
                {unread > 0 && <span className="menu-count">{unread}</span>}
              </NavLink>
            )}
            {user && (
              <NavLink to="/profile">
                <ProfileIcon /> My profile
              </NavLink>
            )}
          </nav>

          <nav className="menu-more" aria-label="More">
            <Link to="/?market=all">All products</Link>
            <Link to="/directory">Business Directory</Link>
            {role !== 'entrepreneur' && role !== 'support' && <Link to="/profile#sell">Sell with us</Link>}
            <Link to="/help">Help</Link>
          </nav>
        </div>
      </dialog>
    </>
  )
}

// The cart stays one tap away at the top right, with how many items are in it.
function CartLink() {
  const { itemCount } = useCart()
  const { user } = useAuth()
  if (user?.role === 'support') return null
  return (
    <Link to="/cart" className="header-icon" aria-label={itemCount ? `Cart, ${itemCount} items` : 'Cart'}>
      <CartIcon />
      {itemCount > 0 && (
        <span className="nav-badge" aria-hidden="true">
          {itemCount}
        </span>
      )}
    </Link>
  )
}

// Changes the site's language - and, when signed in, the language of your SMS too.
function LanguageSelect() {
  const { user } = useAuth()

  async function choose(code: LanguageCode) {
    if (user && user.role !== 'support') {
      await api('/privacy/profile', { method: 'PATCH', body: { preferredLanguage: code } }).catch(() => {})
    }
    setLanguage(code) // reloads the page in the new language
  }

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
        onChange={(e) => choose(e.target.value as LanguageCode)}
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

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong className="footer-brand" translate="no">
          KurumanMarketPlace
        </strong>
        <p>Local sellers, local couriers, local customers. The oasis of the Kalahari, online.</p>
      </div>
      <nav aria-label="Site information">
        <Link to="/?market=all">All products</Link>
        <Link to="/directory">Business Directory</Link>
        <Link to="/profile#sell">Sell with us</Link>
        <Link to="/help">Help</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/returns">Returns &amp; refunds</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/seller-terms">Seller terms</Link>
        <Link to="/courier-terms">Courier terms</Link>
        <Link to="/photo-credits">Photo credits</Link>
      </nav>
    </footer>
  )
}
