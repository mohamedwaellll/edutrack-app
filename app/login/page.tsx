
'use client'

import { useState } from 'react'
import { supabase } from '@/src/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (error) throw error

      const { data: student, error: profileError } = await supabase
        .from('students')
        .select('name, role')
        .eq('user_id', data.user.id)
        .single()

      if (profileError || !student) {
        await supabase.auth.signOut()
        throw new Error('الحساب غير مربوط ببيانات المستخدم في النظام.')
      }

      setIsSuccess(true)
      setMessage(`أهلاً بك يا ${student.name || ''}! جاري فتح حسابك...`)

      const routes: Record<string, string> = {
        admin: '/admin',
        teacher: '/teacher',
        parent: '/parent',
        student: '/student',
      }

      setTimeout(() => {
        window.location.href = routes[student.role] || '/student'
      }, 1200)

    } catch (error) {
      setIsSuccess(false)
      setMessage(
        error instanceof Error
          ? error.message
          : 'حدث خطأ أثناء تسجيل الدخول.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white" dir="rtl">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-400">
          🔑 تسجيل الدخول - EduTrack
        </h2>

        {message && (
          <div className={`p-3 rounded-lg text-center mb-4 text-sm font-medium ${
            isSuccess
              ? 'bg-green-600/20 text-green-400 border border-green-500/30'
              : 'bg-red-600/20 text-red-400 border border-red-500/30'
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="@gmail.com"
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
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left"
              dir="ltr"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition duration-200 shadow-lg shadow-blue-600/30"
          >
            {loading ? 'جاري التحقق...' : 'تسجيل الدخول'}
          </button>
        </form>

        <p className="text-xs text-center text-slate-400 mt-6">
          ليس لديك حساب؟{' '}
          <a href="/register" className="text-blue-400 underline">
            سجل الآن
          </a>
        </p>
      </div>
    </div>
  )
}
