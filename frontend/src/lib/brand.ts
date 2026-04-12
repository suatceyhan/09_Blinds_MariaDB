/** Sablon: Vite ortam degiskeni veya varsayilan uygulama adi */
export function appTitle(): string {
  return import.meta.env.VITE_APP_TITLE?.trim() || 'Blinds'
}
