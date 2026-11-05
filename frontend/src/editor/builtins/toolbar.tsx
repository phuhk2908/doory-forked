import { registerToolbarSection } from '../toolbar/registry'
import { elementColors, onlyKind } from '../toolbar/kinds'
import { loadable } from '../ui/loadable'

// The contextual toolbar registry stays eager, but each section's controls arrive only when that section applies.
const ActionsSection = loadable(() => import('../toolbar/sections/common').then((m) => m.ActionsSection), { fallback: null })
const AlignSection = loadable(() => import('../toolbar/sections/common').then((m) => m.AlignSection), { fallback: null })
const FlipRotateSection = loadable(() => import('../toolbar/sections/common').then((m) => m.FlipRotateSection), { fallback: null })
const GroupSection = loadable(() => import('../toolbar/sections/common').then((m) => m.GroupSection), { fallback: null })
const MultiSection = loadable(() => import('../toolbar/sections/common').then((m) => m.MultiSection), { fallback: null })
const ZOrderSection = loadable(() => import('../toolbar/sections/common').then((m) => m.ZOrderSection), { fallback: null })
const CropSection = loadable(() => import('../toolbar/sections/crop').then((m) => m.CropSection), { fallback: null })
const ImageSection = loadable(() => import('../toolbar/sections/image').then((m) => m.ImageSection), { fallback: null })
const PageSection = loadable(() => import('../toolbar/sections/page').then((m) => m.PageSection), { fallback: null })
const ElementSection = loadable(() => import('../toolbar/sections/shapes').then((m) => m.ElementSection), { fallback: null })
const LineSection = loadable(() => import('../toolbar/sections/shapes').then((m) => m.LineSection), { fallback: null })
const PlaceholderSection = loadable(() => import('../toolbar/sections/shapes').then((m) => m.PlaceholderSection), { fallback: null })
const QrSection = loadable(() => import('../toolbar/sections/shapes').then((m) => m.QrSection), { fallback: null })
const ShapeSection = loadable(() => import('../toolbar/sections/shapes').then((m) => m.ShapeSection), { fallback: null })
const TextSection = loadable(() => import('../toolbar/sections/text').then((m) => m.TextSection), { fallback: null })
const ClipSection = loadable(() => import('../toolbar/sections/clip').then((m) => m.ClipSection), { fallback: null })
const ImageGridSection = loadable(() => import('../toolbar/sections/imageGrid').then((m) => m.ImageGridSection), { fallback: null })

/**
 * The contextual row, in this order: what is specific to the kind, then flip and rotate, order,
 * centre on the page, and lock / duplicate / delete. Each group is one section; sections that do not apply
 * (text has no flip or order group) are skipped and separators follow the groups shown. With nothing
 * selected the row shows the page's colour and actions, so the workspace below it never moves when a selection starts.
 */
export function registerBuiltinToolbarSections(): void {
  const selected = (ids: readonly string[], cropping: unknown): boolean => ids.length > 0 && cropping === null
  registerToolbarSection({ id: 'crop', order: 0, appliesTo: (_s, state) => state.ui.cropping !== null, component: CropSection })
  registerToolbarSection({ id: 'page', order: 10, appliesTo: (sel, state) => sel.ids.length === 0 && state.ui.cropping === null, component: PageSection })
  registerToolbarSection({ id: 'text', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'text'), component: TextSection })
  registerToolbarSection({ id: 'shape', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'shape') && sel.ids.length === 1, component: ShapeSection })
  registerToolbarSection({ id: 'line', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'line') && sel.ids.length === 1, component: LineSection })
  registerToolbarSection({ id: 'image', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'image') && sel.ids.length === 1, component: ImageSection })
  registerToolbarSection({ id: 'image-grid', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'image-grid') && sel.ids.length === 1, component: ImageGridSection })
  registerToolbarSection({ id: 'video', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'video') && sel.ids.length === 1, component: ClipSection })
  registerToolbarSection({ id: 'element', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'element') && sel.ids.length === 1 && elementColors(sel.objects[0]).length > 0, component: ElementSection })
  registerToolbarSection({ id: 'qr', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'qr'), component: QrSection })
  registerToolbarSection({ id: 'placeholder', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'placeholder') && sel.ids.length === 1, component: PlaceholderSection })
  registerToolbarSection({ id: 'group', order: 10, appliesTo: (sel) => onlyKind(sel.kinds, 'group') && sel.ids.length === 1, component: GroupSection })
  registerToolbarSection({ id: 'multi', order: 10, appliesTo: (sel) => sel.ids.length > 1, component: MultiSection })
  registerToolbarSection({ id: 'flip', order: 60, appliesTo: (sel, state) => selected(sel.ids, state.ui.cropping) && !onlyKind(sel.kinds, 'text'), component: FlipRotateSection })
  registerToolbarSection({ id: 'zorder', order: 70, appliesTo: (sel, state) => selected(sel.ids, state.ui.cropping) && !onlyKind(sel.kinds, 'text'), component: ZOrderSection })
  registerToolbarSection({ id: 'align', order: 80, appliesTo: (sel, state) => selected(sel.ids, state.ui.cropping), component: AlignSection })
  registerToolbarSection({ id: 'actions', order: 90, appliesTo: (sel, state) => selected(sel.ids, state.ui.cropping), component: ActionsSection })
}

registerBuiltinToolbarSections()
