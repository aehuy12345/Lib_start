import { api } from '../../api/client'

// 2.7.1 (Librarian + Admin): mỗi thẻ một endpoint để lỗi và Thử lại theo từng thẻ.
async function getSection(section) {
  const { data } = await api.get(`/dashboard/${section}`)
  return data
}

// { titleCount, totalQuantity, available, borrowed, lost, damaged }
export const getBookStats = () => getSection('books')
// { active, disabled }
export const getReaderStats = () => getSection('readers')
// { date, total, byStatus: { pending, borrowing, returned, rejected, cancelled } }
export const getBorrowsToday = () => getSection('borrows-today')
// { books: [{ id, title, author, borrowCount, deleted }] }
export const getTopBooks = () => getSection('top-books')
// { total, limit, readers: [{ id, name, email, maxLateDays, books: [{ borrowOrderId, bookId, title, dueDate, lateDays }] }] }
export const getOverdueReaders = () => getSection('overdue-readers')
