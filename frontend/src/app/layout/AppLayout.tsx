import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookMarked,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  FolderKanban,
  Grid3x3,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Layers,
  ListOrdered,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Shield,
  SlidersHorizontal,
  Tag,
  User,
  UserCog,
  Users,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { appPages } from '@/config/appPages'
import { buildHierarchy, type PageNode } from '@/utils/buildHierarchy'
import { apiBase, getJson, postJson } from '@/lib/api'
import { appTitle } from '@/lib/brand'
import { clearTokens, getAccessToken, setTokens, touchLastActivity } from '@/lib/authStorage'
import { useSessionIdleTimeout } from '@/lib/useSessionIdleTimeout'
import { firstNavigableBasePath, routeViewAllowed } from '@/lib/routePermissions'
import { AuthSessionProvider, REFRESH_SESSION_EVENT, type SessionUser } from '@/app/authSession'

type Me = SessionUser

const pageIcons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  'schedule-root': CalendarDays,
  'customers-root': Users,
  'estimates-root': CalendarDays,
  'orders-root': FolderKanban,
  'lookups-root': BookMarked,
  'lookups-blinds-types': Layers,
  'lookups-blinds-product-categories': Tag,
  'lookups-estimate-statuses': ClipboardList,
  'lookups-order-statuses': ListOrdered,
  'companies-root': Building2,
  'users-root': Users,
  'reports-root': BarChart3,
  'reports-ops': FolderKanban,
  'reports-ops-quarter': CalendarDays,
  'reports-ops-quarter-detail': FileSpreadsheet,
  'settings-group': SlidersHorizontal,
  'permissions-group': KeyRound,
  'settings-roles': Shield,
  'settings-role-matrix': SlidersHorizontal,
  'settings-user-roles': Users,
  'settings-user-permissions': UserCog,
  'settings-pending-applications': Inbox,
  'settings-company-info': Building2,
  'settings-integrations': CalendarDays,
  'settings-blinds-line-matrices': Grid3x3,
  'settings-contract-invoice': FileSpreadsheet,
}

function canSeeNav(me: Me, viewPerm: string): boolean {
  return me.permissions.includes(viewPerm)
}

/** Lookups accordion header: hub key or any submenu .view */
function canSeeLookupsAccordion(me: Me): boolean {
  if (canSeeNav(me, 'lookups.view')) return true
  return appPages.some(
    (p) => p.parent === 'lookups-root' && p.showInNav !== false && canSeeNav(me, p.permissions.view),
  )
}

/** Sidebar accordion ids (single expanded group + route sync in `AppLayout`). */
type AccordionNavSectionId =
  | 'lookups-root'
  | 'reports-root'
  | 'settings-group'
  | 'permissions-group'

const SIDEBAR_NAV_COLLAPSED_KEY = 'blinds_sidebar_nav_collapsed'

function readInitialSidebarNavCollapsed(): boolean {
  if (typeof globalThis.window === 'undefined') return false
  try {
    return globalThis.localStorage.getItem(SIDEBAR_NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function NavSubtree({ nodes, me, depth }: { nodes: PageNode[]; me: Me; depth: number }) {
  const filtered = nodes.filter((node) => canSeeNav(me, node.permissions.view))
  return (
    <>
      {filtered.map((node) => {
        const Icon = pageIcons[node.id] ?? LayoutDashboard
        const to = node.basePath ?? '#'
        const subs = (node.children ?? []).filter((ch) => canSeeNav(me, ch.permissions.view))
        const paddingLeft = 10 + depth * 12
        return (
          <div key={node.id} className="space-y-0.5">
            <NavLink
              to={to}
              end={to === '/'}
              style={{ paddingLeft }}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg py-2.5 pr-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')
              }
            >
              <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
              <span className="flex-1">{node.name}</span>
            </NavLink>
            {subs.length > 0 ? <NavSubtree nodes={subs} me={me} depth={depth + 1} /> : null}
          </div>
        )
      })}
    </>
  )
}

function CollapsibleNavGroup({
  page,
  me,
  open,
  sectionId,
  setExpandedNavId,
  headerVisible,
  navCollapsed,
  children,
}: {
  page: PageNode
  me: Me
  open: boolean
  sectionId: AccordionNavSectionId
  setExpandedNavId: Dispatch<SetStateAction<AccordionNavSectionId | null>>
  /** When set, replaces ``canSeeNav(me, page.permissions.view)`` for the section header row. */
  headerVisible?: (session: Me) => boolean
  /** Desktop (lg+) icon rail: no submenu list until expanded. */
  navCollapsed: boolean
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const showHeader = headerVisible ? headerVisible(me) : canSeeNav(me, page.permissions.view)
  if (!showHeader) return null
  const Icon = pageIcons[page.id] ?? LayoutDashboard
  const to = page.basePath ?? '#'
  const base = to.replace(/\/$/, '') || '/'
  const pathNorm = location.pathname.replace(/\/$/, '') || '/'
  const isActive =
    pathNorm === base || (base !== '/' && pathNorm.startsWith(`${base}/`))

  function handleHeaderClick() {
    if (navCollapsed) {
      navigate(to)
      return
    }
    if (!open) {
      navigate(to)
      setExpandedNavId(sectionId)
    } else {
      setExpandedNavId(null)
    }
  }

  const rowActiveClass = isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600'
  const rowHoverClass = !isActive ? 'hover:bg-slate-100 hover:text-slate-900' : ''

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={handleHeaderClick}
        aria-expanded={navCollapsed ? undefined : open}
        title={page.name}
        aria-label={
          navCollapsed
            ? `Open ${page.name} (overview)`
            : open
              ? `Collapse ${page.name} submenu`
              : `Open ${page.name} submenu and go to overview`
        }
        className={[
          'flex w-full min-h-10 items-center gap-2 rounded-lg py-2 pr-3 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2',
          navCollapsed ? 'lg:justify-center lg:px-0 lg:pr-0' : '',
          rowActiveClass,
          rowHoverClass,
        ].join(' ')}
      >
        <span
          className={`flex w-8 shrink-0 items-center justify-center text-slate-500 ${navCollapsed ? 'lg:hidden' : ''}`}
          aria-hidden
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
            strokeWidth={2}
          />
        </span>
        <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
        <span className={`flex-1 ${navCollapsed ? 'lg:sr-only' : ''}`}>{page.name}</span>
      </button>
      {open && !navCollapsed ? <div className="ml-2 border-l border-slate-200 pl-1">{children}</div> : null}
    </div>
  )
}

function UserAccountMenu({
  me,
  onLogout,
  onSwitchRole,
  onSwitchCompany,
}: {
  me: Me
  onLogout: () => void
  onSwitchRole?: (role: string) => void | Promise<void>
  onSwitchCompany?: (companyId: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const initials = `${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`.toUpperCase() || '?'
  const showProfile = canSeeNav(me, 'account.profile.view')
  const showPassword = canSeeNav(me, 'account.password.view')

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {me.photo_url ? (
          <img
            src={me.photo_url}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white">
            {initials}
          </span>
        )}
        <span className="hidden max-w-[8rem] truncate text-left text-sm font-medium text-slate-800 sm:block">
          {me.first_name}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform sm:ml-0 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg ring-1 ring-slate-900/5"
          role="menu"
        >
          <div className="border-b border-slate-100 px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {me.first_name} {me.last_name}
            </p>
            <p className="truncate text-xs text-slate-500">{me.email}</p>
          </div>
          {me.roles.length > 1 && onSwitchRole ? (
            <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Shield className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
                Active role
              </label>
              <select
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={me.active_role ?? me.roles[0] ?? ''}
                onChange={(e) => {
                  const r = e.target.value
                  void Promise.resolve(onSwitchRole(r)).then(() => setOpen(false))
                }}
                aria-label="Active role"
              >
                {me.roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {(me.companies?.length ?? 0) > 1 && onSwitchCompany ? (
            <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Building2 className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
                Active company
              </label>
              <select
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={me.active_company_id ?? me.company_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  void Promise.resolve(onSwitchCompany(id)).then(() => setOpen(false))
                }}
                aria-label="Active company"
              >
                {me.companies!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {showProfile ? (
            <NavLink
              to="/account"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <User className="h-4 w-4 opacity-70" />
              Profile
            </NavLink>
          ) : null}
          {showPassword ? (
            <NavLink
              to="/account/password"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              Change password
            </NavLink>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function PrimaryNavLink({ page, me, navCollapsed }: { page: PageNode; me: Me; navCollapsed: boolean }) {
  if (!canSeeNav(me, page.permissions.view)) return null
  const Icon = pageIcons[page.id] ?? LayoutDashboard
  const to = page.basePath ?? '#'
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={page.name}
      style={{ paddingLeft: navCollapsed ? undefined : 10 }}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-lg py-2.5 pr-3 text-sm font-medium transition-colors',
          navCollapsed ? 'lg:justify-center lg:px-2 lg:pl-2' : '',
          isActive
            ? 'bg-teal-50 text-teal-800'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')
      }
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
      <span className={`flex-1 ${navCollapsed ? 'lg:sr-only' : ''}`}>{page.name}</span>
    </NavLink>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const title = appTitle()
  const [me, setMe] = useState<Me | null>(null)
  const [activeCompanyBrand, setActiveCompanyBrand] = useState<{
    name: string
    logoHref: string | null
  } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** Desktop (lg+): narrow icon rail; persisted in localStorage. */
  const [navCollapsed, setNavCollapsed] = useState(readInitialSidebarNavCollapsed)

  function toggleNavCollapsed() {
    setNavCollapsed((v) => {
      const next = !v
      try {
        globalThis.localStorage.setItem(SIDEBAR_NAV_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  /** Akordiyon: aynı anda tek grup genişler; rota hangi ağaçtaysa o açılır. */
  type ExpandedNavSection = AccordionNavSectionId | null

  function navSectionForPath(pathname: string): ExpandedNavSection {
    if (pathname === '/reports' || pathname.startsWith('/reports/')) return 'reports-root'
    if (pathname === '/permissions' || pathname.startsWith('/permissions/')) return 'permissions-group'
    if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings-group'
    if (pathname === '/lookups' || pathname.startsWith('/lookups/')) return 'lookups-root'
    return null
  }

  const [expandedNavId, setExpandedNavId] = useState<ExpandedNavSection>(() =>
    navSectionForPath(location.pathname),
  )

  useEffect(() => {
    setExpandedNavId(navSectionForPath(location.pathname))
  }, [location.pathname])

  useSessionIdleTimeout(navigate)

  const { primaryRoots, lookupsRoot, reportsRoot, settingsRoot, permissionsRoot } = useMemo(() => {
    const tree = buildHierarchy(appPages.filter((p) => p.showInNav))
    const reports = tree.find((n) => n.id === 'reports-root')
    const settings = tree.find((n) => n.id === 'settings-group')
    const permissions = tree.find((n) => n.id === 'permissions-group')
    const lookups = tree.find((n) => n.id === 'lookups-root')
    const primary = tree.filter(
      (n) =>
        n.id !== 'reports-root' &&
        n.id !== 'settings-group' &&
        n.id !== 'permissions-group' &&
        n.id !== 'lookups-root',
    )
    return {
      primaryRoots: primary,
      lookupsRoot: lookups,
      reportsRoot: reports,
      settingsRoot: settings,
      permissionsRoot: permissions,
    }
  }, [])

  const loadMe = useCallback(async () => {
    if (!getAccessToken()) {
      setMe(null)
      return
    }
    try {
      const u = await getJson<Me>('/auth/me')
      setMe(u)
    } catch {
      setMe(null)
    }
  }, [])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  useEffect(() => {
    function onRefresh() {
      void loadMe()
    }
    globalThis.addEventListener(REFRESH_SESSION_EVENT, onRefresh)
    return () => globalThis.removeEventListener(REFRESH_SESSION_EVENT, onRefresh)
  }, [loadMe])

  useEffect(() => {
    if (!me) return
    const pathNorm = location.pathname.replace(/\/$/, '') || '/'
    if (me.must_change_password && pathNorm === '/account/password') return
    if (routeViewAllowed(location.pathname, me.permissions)) return
    const dest = firstNavigableBasePath(me.permissions)
    const destNorm = dest.replace(/\/$/, '') || '/'
    if (destNorm === pathNorm) return
    navigate(dest, { replace: true })
  }, [me, location.pathname, navigate])

  useEffect(() => {
    if (!getAccessToken()) return
    touchLastActivity()
  }, [location.pathname])

  useEffect(() => {
    const id = (me?.active_company_id ?? me?.company_id ?? '').trim()
    const nameFallback = (me?.active_company_name ?? me?.company_name ?? '').trim()
    if (!id) {
      setActiveCompanyBrand(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // Best-effort: if the user can view company details, show logo + name.
        const co = await getJson<{ name: string; logo_url?: string | null }>(`/companies/${id}`)
        if (cancelled) return
        const rawLogo = (co.logo_url ?? '').trim()
        const logoHref = rawLogo ? `${apiBase()}${rawLogo.startsWith('/') ? rawLogo : `/${rawLogo}`}` : null
        setActiveCompanyBrand({ name: (co.name ?? '').trim() || nameFallback || title, logoHref })
      } catch {
        if (!cancelled) {
          setActiveCompanyBrand({ name: nameFallback || title, logoHref: null })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me?.active_company_id, me?.company_id, me?.active_company_name, me?.company_name, title])

  async function switchRole(role: string) {
    if (!me || role === (me.active_role ?? me.roles[0] ?? '')) return
    try {
      const res = await postJson<{ access_token: string }>('/auth/switch-role', { role })
      setTokens(res.access_token)
      const u = await getJson<Me>('/auth/me')
      setMe(u)
    } catch {
      /* silent */
    }
  }

  async function switchCompany(companyId: string) {
    const sessionCompany = me?.active_company_id ?? me?.company_id
    if (!me || !companyId || String(companyId) === String(sessionCompany ?? '')) return
    try {
      const res = await postJson<{ access_token: string }>('/auth/switch-company', {
        company_id: companyId,
      })
      setTokens(res.access_token)
      const u = await getJson<Me>('/auth/me')
      setMe(u)
    } catch {
      /* silent */
    }
  }

  async function logout() {
    try {
      const t = getAccessToken()
      await fetch(`${apiBase()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
      })
    } catch {
      /* continue */
    }
    clearTokens()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200/80 bg-white shadow-sm transition-[transform,width] duration-200 ease-out lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${navCollapsed ? 'lg:w-[4.5rem]' : 'lg:w-64'}`}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-100 px-5 lg:px-3">
          <div
            className={`flex min-w-0 items-center gap-2 ${navCollapsed ? 'lg:flex-1 lg:justify-center' : 'flex-1'}`}
          >
            {activeCompanyBrand?.logoHref ? (
              <img
                src={activeCompanyBrand.logoHref}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
                loading="lazy"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
                {(activeCompanyBrand?.name ?? title).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className={`min-w-0 flex-1 leading-tight ${navCollapsed ? 'lg:hidden' : ''}`}>
              <p className="truncate text-sm font-semibold text-slate-800">
                {activeCompanyBrand?.name ?? title}
              </p>
              <p className="text-xs text-slate-500">Blinds</p>
            </div>
          </div>
          <button
            type="button"
            className="hidden shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex"
            onClick={toggleNavCollapsed}
            aria-expanded={!navCollapsed}
            aria-controls="app-primary-nav"
            title={navCollapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={navCollapsed ? 'Expand sidebar menu' : 'Collapse sidebar menu'}
          >
            {navCollapsed ? (
              <PanelLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
            ) : (
              <PanelLeftClose className="h-5 w-5" strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>
        <nav
          id="app-primary-nav"
          className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-3"
        >
          {me
            ? primaryRoots.map((p) => (
                <PrimaryNavLink key={p.id} page={p} me={me} navCollapsed={navCollapsed} />
              ))
            : null}
          {me && lookupsRoot ? (
            <CollapsibleNavGroup
              page={lookupsRoot}
              me={me}
              open={expandedNavId === 'lookups-root'}
              sectionId="lookups-root"
              setExpandedNavId={setExpandedNavId}
              headerVisible={canSeeLookupsAccordion}
              navCollapsed={navCollapsed}
            >
              <NavSubtree nodes={lookupsRoot.children ?? []} me={me} depth={0} />
            </CollapsibleNavGroup>
          ) : null}
          {me && reportsRoot ? (
            <CollapsibleNavGroup
              page={reportsRoot}
              me={me}
              open={expandedNavId === 'reports-root'}
              sectionId="reports-root"
              setExpandedNavId={setExpandedNavId}
              navCollapsed={navCollapsed}
            >
              <NavSubtree nodes={reportsRoot.children ?? []} me={me} depth={0} />
            </CollapsibleNavGroup>
          ) : null}
          {me && settingsRoot ? (
            <CollapsibleNavGroup
              page={settingsRoot}
              me={me}
              open={expandedNavId === 'settings-group'}
              sectionId="settings-group"
              setExpandedNavId={setExpandedNavId}
              navCollapsed={navCollapsed}
            >
              <NavSubtree nodes={settingsRoot.children ?? []} me={me} depth={0} />
            </CollapsibleNavGroup>
          ) : null}
          {me && permissionsRoot ? (
            <CollapsibleNavGroup
              page={permissionsRoot}
              me={me}
              open={expandedNavId === 'permissions-group'}
              sectionId="permissions-group"
              setExpandedNavId={setExpandedNavId}
              navCollapsed={navCollapsed}
            >
              <NavSubtree nodes={permissionsRoot.children ?? []} me={me} depth={0} />
            </CollapsibleNavGroup>
          ) : null}
        </nav>
        <div
          className={`border-t border-slate-100 p-3 text-xs text-slate-500 ${navCollapsed ? 'lg:hidden' : ''}`}
        >
          Branding: set <code className="text-slate-700">VITE_APP_TITLE</code>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/20 lg:hidden"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col lg:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center justify-end gap-3">
            {me ? (
              <>
                <div className="hidden items-center gap-3 sm:flex">
                  {me.roles.length > 1 ? (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="whitespace-nowrap">Active role</span>
                      <select
                        className="max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        value={me.active_role ?? me.roles[0] ?? ''}
                        onChange={(e) => void switchRole(e.target.value)}
                        aria-label="Active role"
                      >
                        {me.roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {(me.companies?.length ?? 0) > 1 ? (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="whitespace-nowrap">Active company</span>
                      <select
                        className="max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        value={me.active_company_id ?? me.company_id ?? ''}
                        onChange={(e) => void switchCompany(e.target.value)}
                        aria-label="Active company"
                      >
                        {me.companies!.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <UserAccountMenu
                  me={me}
                  onLogout={() => void logout()}
                  onSwitchRole={me.roles.length > 1 ? (r) => switchRole(r) : undefined}
                  onSwitchCompany={
                    (me.companies?.length ?? 0) > 1 ? (id) => switchCompany(id) : undefined
                  }
                />
              </>
            ) : (
              <span className="text-sm text-slate-400">Loading…</span>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <AuthSessionProvider value={me}>
            <Outlet />
          </AuthSessionProvider>
        </main>
      </div>
    </div>
  )
}
