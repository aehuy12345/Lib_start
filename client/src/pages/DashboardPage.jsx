import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'

const TITLES = {
  reader: 'Dashboard độc giả',
  librarian: 'Dashboard nhân viên thư viện',
  admin: 'Dashboard quản lý',
}

// Khung dashboard theo vai trò; nội dung thật thêm ở các tính năng sau (vd 2.7.1).
export default function DashboardPage() {
  const { user, logout } = useAuth()

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{TITLES[user.role]}</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/books" className="font-medium text-blue-600 hover:underline">Danh sách sách</Link>
          {user.role === 'reader' && (
            <>
              <Link to="/reader/borrow-history" className="font-medium text-blue-600 hover:underline">Lịch sử mượn sách</Link>
              <Link to="/reader/profile" className="font-medium text-blue-600 hover:underline">Hồ sơ</Link>
            </>
          )}
          {user.role !== 'reader' && (
            <>
              <Link to={`/${user.role}/books/new`} className="font-medium text-blue-600 hover:underline">Thêm Sách Mới</Link>
              <Link to={`/${user.role}/categories`} className="font-medium text-blue-600 hover:underline">Thể loại sách</Link>
              <Link to={`/${user.role}/borrow-orders`} className="font-medium text-blue-600 hover:underline">Đơn mượn chờ xác nhận</Link>
              <Link to={`/${user.role}/return-requests`} className="font-medium text-blue-600 hover:underline">Quản lý trả sách</Link>
            </>
          )}
          {user.role === 'admin' && (
            <Link to="/admin/fine-tiers" className="font-medium text-blue-600 hover:underline">Mức phạt</Link>
          )}
          <span className="text-slate-700">{user.name}</span>
          <button type="button" onClick={logout} className="font-medium text-blue-600 hover:underline">
            Đăng xuất
          </button>
        </div>
      </header>
      <section className="p-6 text-sm text-slate-600">Xin chào, {user.name}.</section>
    </main>
  )
}
