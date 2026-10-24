import { useState } from 'react'

// 2.2.3 edge 7, 8 và 2.2.4 edge 8: khung cố định để bố cục không nhảy; chưa có ảnh hoặc ảnh lỗi thì hiện ảnh mặc định.
export default function BookCover({ url, title, lazy = true }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <img
        src={url}
        alt={`Ảnh bìa ${title}`}
        loading={lazy ? 'lazy' : undefined}
        onError={() => setFailed(true)}
        className="aspect-[2/3] w-full rounded object-cover"
      />
    )
  }
  return (
    <div role="img" aria-label="Ảnh bìa mặc định" className="flex aspect-[2/3] w-full items-center justify-center rounded bg-slate-200 text-slate-400">
      <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5z" />
        <path d="M4 19a2 2 0 0 1 2-2h12" />
      </svg>
    </div>
  )
}
