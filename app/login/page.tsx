'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pelqdzfblutgoppvzmrz.supabase.co'
const supabaseAnonKey = 'sb_publishable_upsdvQ_EbmC-ZR7p0DY2Gw_-NngndX0'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('student')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      // طباعة البيانات في الconsole للتشخيص الدقيق
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('email', email.trim().toLowerCase())

      console.log('Supabase Error:', error)
      console.log('Supabase Data:', data)

      if (error || !data || data.length === 0) {
        setIsSuccess(false)
        setMessage('البريد الإلكتروني غير مسجل في النظام!')
      } else {
        const user = data[0]

        if (user.password !== password) {
          setIsSuccess(false)
          setMessage('كلمة المرور غير صحيحة، يُرجى المحاولة مرة أخرى!')
        } else {
          setIsSuccess(true)
          setMessage(`أهلاً بك يا ${user.name}! جاري توجيهك لوحة التحكم...`)
          
          setTimeout(() => {
            const userRole = user.role || role
            if (userRole === 'admin') window.location.href = '/admin'
            else if (userRole === 'teacher') window.location.href = '/teacher'
            else if (userRole === 'parent') window.location.href = '/parent'
            else window.location.href = '/student'
          }, 1500)
        }
      }
    } catch (err) {
      console.error('Catch Error:', err)
      setIsSuccess(false)
      setMessage('حدث خطأ أثناء تسجيل الدخول، يُرجى التحقق من الاتصال بالإنترنت')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white dir-rtl" dir="rtl">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-400">
          🔑 تسجيل الدخول - EduTrack
        </h2>

        {message && (
          <div className={`p-3 rounded-lg text-center mb-4 text-sm font-medium ${isSuccess ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-500/30'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">البريد الإلكتروني</label>
            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="@gmail.com"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left dir-ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">كلمة المرور</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left dir-ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">تحديد الدور (Role)</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-200"
            >
              <option value="student">🎓 طالب (Student)</option>
              <option value="teacher">👨‍🏫 معلم (Teacher)</option>
              <option value="admin">🛡️ أدمن / سنتر (Admin)</option>
              <option value="parent">👨‍👩‍👦 ولي أمر (Parent)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition duration-200 shadow-lg shadow-blue-600/30"
          >
            {loading ? 'جاري التحقق...' : 'تسجيل الدخول'}
          </button>
        </form>

        <p className="text-xs text-center text-slate-400 mt-6">
          ليس لديك حساب؟ <a href="/register" className="text-blue-400 underline">سجل الآن</a>
        </p>
      </div>
    </div>
  )
}