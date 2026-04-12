import { createContext, useContext } from 'react'

/** `/auth/me` yenilemesi (profil varsayılanları vb.). */
export const REFRESH_SESSION_EVENT = 'app:refresh-session'

export type SessionCompanyRef = { id: string; name: string }

/** `/auth/me` yanıtı; AppLayout ile alt sayfalar arasında tek kaynak. */
export type SessionUser = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  roles: string[]
  active_role: string | null
  /** Sonraki girişte kullanılacak varsayılan rol adı (`/auth/me`). */
  default_role?: string | null
  permissions: string[]
  must_change_password?: boolean
  /** Varsayılan (DB) şirket — profilden “default” chip. */
  company_name?: string | null
  company_id?: string | null
  /** Oturumdaki aktif şirket (JWT); header seçici burayı kullanır. */
  active_company_id?: string | null
  active_company_name?: string | null
  /** ISO 3166-1 alpha-2 from active company row; drives address autocomplete country filter. */
  active_company_country_code?: string | null
  companies?: SessionCompanyRef[]
  photo_url?: string | null
}

const AuthSessionContext = createContext<SessionUser | null>(null)

export function useAuthSession(): SessionUser | null {
  return useContext(AuthSessionContext)
}

export const AuthSessionProvider = AuthSessionContext.Provider
