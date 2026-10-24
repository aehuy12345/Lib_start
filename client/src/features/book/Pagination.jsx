const BUTTON_CLASS = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

// Dùng cho danh sách sách (2.2.3) và lịch sử mượn (2.2.4). Một trang thì không hiện.
export default function Pagination({ page, totalPages, onPage, label = 'Phân trang' }) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label={label} className="mt-6 flex items-center justify-center gap-3 text-sm">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BUTTON_CLASS}>
        Trang trước
      </button>
      <span className="text-slate-700">Trang {page} / {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={BUTTON_CLASS}>
        Trang sau
      </button>
    </nav>
  )
}
