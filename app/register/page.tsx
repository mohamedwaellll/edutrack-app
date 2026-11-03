
'use client'

import { useState } from 'react'
import { supabase } from '@/src/lib/supabase'

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'student',
    academic_year: 'الصف الثالث الثانوي',
  })

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setIsSuccess(false)

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            name: formData.name.trim(),
            phone: formData.phone.trim(),
            role: formData.role,
            academic_year:
              formData.role === 'student'
                ? formData.academic_year
                : null,
          },
        },
      })

      if (error) throw error

      if (data.user) {
        setIsSuccess(true)
        setMessage(
          'تم إنشاء الحساب بنجاح! برجاء فتح بريدك الإلكتروني والضغط على رابط تأكيد الحساب.'
        )

        setFormData({
          name: '',
          email: '',
          phone: '',
          password: '',
          role: 'student',
          academic_year: 'الصف الثالث الثانوي',
        })
      } else {
        throw new Error('لم يتم إنشاء الحساب، حاول مرة أخرى.')
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'حدث خطأ أثناء إنشاء الحساب.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white"
      dir="rtl"
    >
      <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-400">
          📝 إنشاء حساب جديد - EduTrack
        </h2>

        {message && (
          <div
            className={`p-3 rounded-lg text-center mb-4 text-sm font-medium ${
              isSuccess
                ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                : 'bg-red-600/20 text-red-400 border border-red-500/30'
            }`}
          >
            {message}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              الاسم الكامل
            </label>
            <input
              type="text"
              name="name"
              required
              autoComplete="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="أدخل اسمك بالكامل"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="@gmail.com"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              رقم الهاتف
            </label>
            <input
              type="tel"
              name="phone"
              required
              autoComplete="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder="***********"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              كلمة المرور
            </label>
            <input
              type="password"
              name="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              نوع الحساب
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-200"
            >
              <option value="student">🎓 طالب (Student)</option>
              <option value="parent">👨‍👩‍👦 ولي أمر (Parent)</option>
            </select>
          </div>

          {formData.role === 'student' && (
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-300">
                السنة الدراسية
              </label>
              <select
                name="academic_year"
                value={formData.academic_year}
                onChange={handleChange}
                className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-200"
              >
                <option value="الصف الأول الإعدادي">الصف الأول الإعدادي</option>
                <option value="الصف الثاني الإعدادي">الصف الثاني الإعدادي</option>
                <option value="الصف الثالث الإعدادي">الصف الثالث الإعدادي</option>
                <option value="الصف الأول الثانوي">الصف الأول الثانوي</option>
                <option value="الصف الثاني الثانوي">الصف الثاني الثانوي</option>
                <option value="الصف الثالث الثانوي">الصف الثالث الثانوي</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition duration-200 shadow-lg shadow-blue-600/30"
          >
            {loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب'}
          </button>
        </form>

        <p className="text-xs text-center text-slate-400 mt-6">
          لديك حساب بالفعل؟{' '}
          <a href="/login" className="text-blue-400 underline">
            تسجيل الدخول
          </a>
        </p>
      </div>
    </div>
  )
}
