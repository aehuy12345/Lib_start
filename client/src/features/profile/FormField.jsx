// Ô nhập dùng chung cho các form hồ sơ, cùng kiểu với form đăng ký/đăng nhập.
export default function FormField({ id, label, error, registration, ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        id={id}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500"
        {...inputProps}
        {...registration}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-600">{error.message}</p>}
    </div>
  )
}

