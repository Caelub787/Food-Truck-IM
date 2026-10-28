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
import { OwnerPage } from '@/features/owner/OwnerPage'
import { PeoplePage } from '@/features/people/PeoplePage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AppShell } from './AppShell'

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
              {
                element: <RequireRole roles={['admin', 'manager']} />,
                children: [{ path: 'people', element: <PeoplePage /> }],
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
