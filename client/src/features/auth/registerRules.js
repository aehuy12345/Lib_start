// Quy tắc validate 2.1.1, khớp với server/src/modules/auth/auth.validation.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const registerRules = {
  email: {
    validate: (v) => {
      const value = v.trim()
      if (!value) return 'Email không được để trống'
      if (value.length > 255) return 'Email tối đa 255 ký tự'
      return EMAIL_PATTERN.test(value) || 'Email không đúng định dạng'
    },
  },
  name: {
    validate: (v) => {
      const value = v.trim()
      if (!value) return 'Tên không được để trống'
      return value.length <= 50 || 'Tên tối đa 50 ký tự'
    },
  },
  password: {
    required: 'Mật khẩu không được để trống',
    minLength: { value: 8, message: 'Mật khẩu tối thiểu 8 ký tự' },
    maxLength: { value: 16, message: 'Mật khẩu tối đa 16 ký tự' },
  },
  confirmPassword: {
    required: 'Xác nhận mật khẩu không được để trống',
    validate: (v, values) => v === values.password || 'Xác nhận mật khẩu không khớp',
  },
}
