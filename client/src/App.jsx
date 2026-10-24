import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthContext'
import RequireAuth from './features/auth/RequireAuth'
import AddBookPage from './pages/AddBookPage'
import BookDetailPage from './pages/BookDetailPage'
import BooksPage from './pages/BooksPage'
import CategoriesPage from './pages/CategoriesPage'
import DashboardPage from './pages/DashboardPage'
import EditBookPage from './pages/EditBookPage'
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
          <Route path="/librarian" element={<RequireAuth roles={['librarian']}><DashboardPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth roles={['admin']}><DashboardPage /></RequireAuth>} />
          <Route path="/librarian/categories" element={<RequireAuth roles={['librarian']}><CategoriesPage /></RequireAuth>} />
          <Route path="/admin/categories" element={<RequireAuth roles={['admin']}><CategoriesPage /></RequireAuth>} />
          <Route path="/librarian/books/new" element={<RequireAuth roles={['librarian']}><AddBookPage /></RequireAuth>} />
          <Route path="/admin/books/new" element={<RequireAuth roles={['admin']}><AddBookPage /></RequireAuth>} />
          <Route path="/librarian/books/:id/edit" element={<RequireAuth roles={['librarian']}><EditBookPage /></RequireAuth>} />
          <Route path="/admin/books/:id/edit" element={<RequireAuth roles={['admin']}><EditBookPage /></RequireAuth>} />
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
