import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { CartProvider } from './cart/CartContext'
import { Layout } from './components/Layout'
import { RegisterPage, SignInPage } from './pages/AuthPages'
import { CartPage } from './pages/CartPage'
import { HomePage } from './pages/HomePage'
import { OrdersPage } from './pages/OrdersPage'
import { ProfilePage } from './pages/ProfilePage'
import { SellerDashboardPage } from './pages/seller/SellerDashboardPage'
import { SellerProductFormPage, SellerProductsPage } from './pages/seller/SellerProductsPage'
import { RequireRole } from './auth/RequireRole'
import { CourierPage } from './pages/courier/CourierPage'
import { SupportPage } from './pages/support/SupportPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="signin" element={<SignInPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route element={<RequireRole role="entrepreneur" />}>
                <Route path="seller" element={<SellerDashboardPage />} />
                <Route path="seller/products" element={<SellerProductsPage />} />
                <Route path="seller/products/:id" element={<SellerProductFormPage />} />
              </Route>
              <Route element={<RequireRole role="courier" />}>
                <Route path="courier" element={<CourierPage />} />
              </Route>
              <Route element={<RequireRole role="support" />}>
                <Route path="support" element={<SupportPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
