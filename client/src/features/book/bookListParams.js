// 2.2.3: trạng thái lọc + trang nằm trên URL để chia sẻ được và nút Back hoạt động.
export const SORT_OPTIONS = [
  { value: 'name', label: 'Tên (A-Z)' },
  { value: 'newest', label: 'Năm xuất bản (mới nhất)' },
  { value: 'popular', label: 'Lượt mượn (phổ biến nhất)' },
]
const SORTS = SORT_OPTIONS.map((o) => o.value)
export const DEFAULT_SORT = 'name'

// Giá trị lạ trên URL được thay bằng mặc định, giống server.
export function readListParams(searchParams) {
  const q = (searchParams.get('q') ?? '').trim()
  const categoryId = searchParams.get('categoryId') ?? ''
  const sort = SORTS.includes(searchParams.get('sort')) ? searchParams.get('sort') : DEFAULT_SORT
  const page = Number(searchParams.get('page'))
  return { q, categoryId, sort, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

// Đổi từ khóa, thể loại hoặc sắp xếp thì quay về trang 1. Giá trị mặc định không ghi lên URL.
export function nextListParams(current, changes) {
  const next = { ...current, ...changes }
  if (!('page' in changes)) next.page = 1
  const out = {}
  if (next.q?.trim()) out.q = next.q.trim()
  if (next.categoryId) out.categoryId = String(next.categoryId)
  if (next.sort && next.sort !== DEFAULT_SORT) out.sort = next.sort
  if (next.page > 1) out.page = String(next.page)
  return out
}

export function hasFilters({ q, categoryId }) {
  return Boolean(q || categoryId)
}
