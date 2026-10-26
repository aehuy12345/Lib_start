import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthContext'
import RequireAuth from './features/auth/RequireAuth'
import AddBookPage from './pages/AddBookPage'
import BookDetailPage from './pages/BookDetailPage'
import BooksPage from './pages/BooksPage'
import BorrowHistoryPage from './pages/BorrowHistoryPage'
import FinesPage from './pages/FinesPage'
import BorrowRequestsPage from './pages/BorrowRequestsPage'
import ReturnRequestsPage from './pages/ReturnRequestsPage'
import CategoriesPage from './pages/CategoriesPage'
import DashboardPage from './pages/DashboardPage'
import EditBookPage from './pages/EditBookPage'
import FineTiersPage from './pages/FineTiersPage'
import FineTicketsPage from './pages/FineTicketsPage'
import UsersPage from './pages/UsersPage'
import ReportsPage from './pages/ReportsPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import RegisterPage from './pages/RegisterPage'
import VerifyEmailPage from './pages/VerifyEmailPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/reader" element={<RequireAuth roles={['reader']}><DashboardPage /></RequireAuth>} />
          <Route path="/reader/profile" element={<RequireAuth roles={['reader']}><ProfilePage /></RequireAuth>} />
          <Route path="/reader/borrow-history" element={<RequireAuth roles={['reader']}><BorrowHistoryPage /></RequireAuth>} />
          <Route path="/reader/fines" element={<RequireAuth roles={['reader']}><FinesPage /></RequireAuth>} />
          <Route path="/librarian" element={<RequireAuth roles={['librarian']}><DashboardPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth roles={['admin']}><DashboardPage /></RequireAuth>} />
          <Route path="/librarian/categories" element={<RequireAuth roles={['librarian']}><CategoriesPage /></RequireAuth>} />
          <Route path="/admin/categories" element={<RequireAuth roles={['admin']}><CategoriesPage /></RequireAuth>} />
          <Route path="/librarian/books/new" element={<RequireAuth roles={['librarian']}><AddBookPage /></RequireAuth>} />
          <Route path="/admin/books/new" element={<RequireAuth roles={['admin']}><AddBookPage /></RequireAuth>} />
          <Route path="/librarian/books/:id/edit" element={<RequireAuth roles={['librarian']}><EditBookPage /></RequireAuth>} />
          <Route path="/admin/books/:id/edit" element={<RequireAuth roles={['admin']}><EditBookPage /></RequireAuth>} />
          <Route path="/librarian/borrow-orders" element={<RequireAuth roles={['librarian']}><BorrowRequestsPage /></RequireAuth>} />
          <Route path="/admin/borrow-orders" element={<RequireAuth roles={['admin']}><BorrowRequestsPage /></RequireAuth>} />
          <Route path="/librarian/return-requests" element={<RequireAuth roles={['librarian']}><ReturnRequestsPage /></RequireAuth>} />
          <Route path="/admin/return-requests" element={<RequireAuth roles={['admin']}><ReturnRequestsPage /></RequireAuth>} />
          <Route path="/librarian/fine-tickets" element={<RequireAuth roles={['librarian']}><FineTicketsPage /></RequireAuth>} />
          <Route path="/admin/fine-tickets" element={<RequireAuth roles={['admin']}><FineTicketsPage /></RequireAuth>} />
          {/* 2.7.2: Librarian + Admin; Reader bị chuyển về dashboard của mình (edge 8). */}
          <Route path="/librarian/reports" element={<RequireAuth roles={['librarian']}><ReportsPage /></RequireAuth>} />
          <Route path="/admin/reports" element={<RequireAuth roles={['admin']}><ReportsPage /></RequireAuth>} />
          {/* 2.6.1: chỉ Admin (edge 8). */}
          <Route path="/admin/users" element={<RequireAuth roles={['admin']}><UsersPage /></RequireAuth>} />
          {/* 2.5.1: chỉ Admin; nhân viên thư viện bị chuyển về dashboard của mình (edge 6). */}
          <Route path="/admin/fine-tiers" element={<RequireAuth roles={['admin']}><FineTiersPage /></RequireAuth>} />
          {/* 2.2.3: danh sách sách công khai là trang chủ. */}
          <Route path="/" element={<Navigate to="/books" replace />} />
          <Route path="/books" element={<BooksPage />} />
          <Route path="/books/:id" element={<BookDetailPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
