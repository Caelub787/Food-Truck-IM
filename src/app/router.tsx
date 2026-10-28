import { createBrowserRouter, Navigate } from 'react-router'
import { AccountPage } from '@/features/account/AccountPage'
import { CheckEmailPage } from '@/features/auth/CheckEmailPage'
import { ConfirmPage } from '@/features/auth/ConfirmPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { RequireMember, RequireOwner, RequireRole, RequireSession } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/LoginPage'
import { SetPasswordPage } from '@/features/auth/SetPasswordPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { WelcomePage } from '@/features/auth/WelcomePage'
import { HomePage } from '@/features/home/HomePage'
import { CountPage } from '@/features/inventory/CountPage'
import { HistoryPage } from '@/features/inventory/HistoryPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { MovePage } from '@/features/inventory/MovePage'
import { ReceivePage } from '@/features/inventory/ReceivePage'
import { OwnerPage } from '@/features/owner/OwnerPage'
import { PeoplePage } from '@/features/people/PeoplePage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AddOnsPage } from '@/features/setup/AddOnsPage'
import { ImportPage } from '@/features/setup/ImportPage'
import { ListsPage } from '@/features/setup/ListsPage'
import { LocationsPage } from '@/features/setup/LocationsPage'
import { ProductEditorPage } from '@/features/setup/ProductEditorPage'
import { ProductsPage } from '@/features/setup/ProductsPage'
import { SetupHome } from '@/features/setup/SetupHome'
import { SuppliersPage } from '@/features/setup/SuppliersPage'
import { SuppliesPage } from '@/features/setup/SuppliesPage'
import { TrucksPage } from '@/features/setup/TrucksPage'
import { AppShell } from './AppShell'
import { MorePage } from './MorePage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/signup/check-email', element: <CheckEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/confirm', element: <ConfirmPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  {
    element: <RequireSession />,
    children: [
      { path: '/welcome', element: <WelcomePage /> },
      {
        element: <RequireMember />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'account', element: <AccountPage /> },
              { path: 'more', element: <MorePage /> },
              {
                element: <RequireRole roles={['admin', 'manager']} />,
                children: [
                  { path: 'people', element: <PeoplePage /> },
                  { path: 'inventory', element: <InventoryPage /> },
                  { path: 'inventory/receive', element: <ReceivePage /> },
                  { path: 'inventory/count', element: <CountPage /> },
                  { path: 'inventory/move', element: <MovePage /> },
                  { path: 'inventory/history', element: <HistoryPage /> },
                  { path: 'setup', element: <SetupHome /> },
                  { path: 'setup/locations', element: <LocationsPage /> },
                  { path: 'setup/trucks', element: <TrucksPage /> },
                  { path: 'setup/suppliers', element: <SuppliersPage /> },
                  { path: 'setup/supplies', element: <SuppliesPage /> },
                  { path: 'setup/products', element: <ProductsPage /> },
                  { path: 'setup/products/:id', element: <ProductEditorPage /> },
                  { path: 'setup/addons', element: <AddOnsPage /> },
                  { path: 'setup/lists', element: <ListsPage /> },
                  { path: 'setup/import', element: <ImportPage /> },
                ],
              },
              {
                element: <RequireRole roles={['admin']} />,
                children: [{ path: 'settings', element: <SettingsPage /> }],
              },
              {
                element: <RequireOwner />,
                children: [{ path: 'owner', element: <OwnerPage /> }],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
