import { api } from '../../api/client'

// 2.7.2 (Librarian + Admin). query: { from, to, groupBy?, page? } từ reportQuery.
export async function getReport(type, query) {
  const { data } = await api.get(`/reports/${type}`, { params: query })
  return data
}

// Edge 6: server truy vấn lại với đúng bộ lọc đang xem rồi trả file; tải bằng axios để gửi kèm token.
export async function downloadReportCsv(type, query, fileName) {
  let data
  try {
    ({ data } = await api.get(`/reports/${type}/csv`, { params: query, responseType: 'blob' }))
  } catch (err) {
    // Lỗi cũng về dạng Blob; đọc lại JSON { message, errors } để parseApiError dùng được.
    const body = err?.response?.data
    if (body instanceof Blob) {
      try { err.response.data = JSON.parse(await body.text()) } catch { /* giữ nguyên */ }
    }
    throw err
  }
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
