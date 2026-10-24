// Cùng quy tắc với server (PRD 2.2.1): trim, không rỗng, tối đa 50 ký tự.
export const NAME_MAX = 50

export function validateCategoryName(value) {
  const name = (value ?? '').trim()
  if (!name) return 'Tên thể loại không được để trống'
  if (name.length > NAME_MAX) return `Tên thể loại tối đa ${NAME_MAX} ký tự`
  return ''
}
