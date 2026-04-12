import type { PageConfig } from '@/config/appPages'

export interface PageNode extends PageConfig {
  children?: PageNode[]
}

export function buildHierarchy(pages: PageConfig[]): PageNode[] {
  const map = new Map<string, PageNode>()
  const roots: PageNode[] = []

  pages.forEach((page) => {
    map.set(page.id, { ...page, children: [] })
  })

  pages.forEach((page) => {
    const node = map.get(page.id)!
    if (page.parent) {
      const parent = map.get(page.parent)
      if (parent) {
        parent.children = parent.children ?? []
        parent.children.push(node)
      }
    } else {
      roots.push(node)
    }
  })

  return roots
}
