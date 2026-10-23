import { registerRules } from '../auth/registerRules'

// Quy tắc validate 2.1.3, khớp với server/src/modules/profile/profile.validation.js.
const PHONE_PATTERN = /^(0\d{9}|\+84\d{9})$/

export const profileRules = {
  name: registerRules.name,
  phone: {
    validate: (v) => {
      const value = v.trim()
      return !value || PHONE_PATTERN.test(value) || 'Số điện thoại không đúng định dạng'
    },
  },
  address: {
    validate: (v) => {
      const value = v.trim()
      if (!value) return 'Địa chỉ không được để trống'
      return value.length <= 255 || 'Địa chỉ tối đa 255 ký tự'
    },
  },
}

export const passwordRules = {
  currentPassword: { required: 'Mật khẩu hiện tại không được để trống' },
  newPassword: registerRules.password,
  confirmPassword: {
    required: 'Xác nhận mật khẩu không được để trống',
    validate: (v, values) => v === values.newPassword || 'Xác nhận mật khẩu không khớp',
  },
}

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_ERROR = 'Chỉ nhận ảnh JPG, PNG, WebP tối đa 2 MB'

// Kiểm tra nhanh ở client; server kiểm tra lại theo nội dung file.
export function validateAvatarFile(file) {
  if (!file || !AVATAR_TYPES.includes(file.type) || file.size > AVATAR_MAX_BYTES) return AVATAR_ERROR
  return null
}
