import { registerRules } from './registerRules'

// 2.1.2 dùng cùng quy tắc email/mật khẩu với đăng ký.
export const loginRules = {
  email: registerRules.email,
  password: registerRules.password,
}
