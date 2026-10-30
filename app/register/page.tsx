'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pelqdzfblutgoppvzmrz.supabase.co'
const supabaseAnonKey = 'sb_publishable_upsdvQ_EbmC-ZR7p0DY2Gw_-NngndX0'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'student', 
    academic_year: 'الصف الثالث الثانوي',
  })

  const [secretCode, setSecretCode] = useState('')
  const CENTER_SECRET_KEY = '123456'

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if ((formData.role === 'admin' || formData.role === 'teacher') && secretCode !== CENTER_SECRET_KEY) {
      setIsSuccess(false)
      setMessage('عفواً، كود التفعيل السري للسنتر غير صحيح! لا يمكن التسجيل بهذا الدور.')
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('students')
        .insert([
          {
            name: formData.name.trim(),
            email: formData.email.trim().toLowerCase(),
            phone: formData.phone.trim(),
            password: formData.password,
            role: formData.role,
            academic_year: formData.role === 'student' ? formData.academic_year : null,
          }
        ])

      if (error) {
        setIsSuccess(false)
        setMessage('حدث خطأ أثناء إنشاء الحساب: ' + error.message)
      } else {
        setIsSuccess(true)
        setMessage('تم إنشاء الحساب بنجاح! جاري توجيهك لصفحة تسجيل الدخول...')
        
        setTimeout(() => {
          window.location.href = '/login'
        }, 2000)
      }
    } catch (err: any) {
      setIsSuccess(false)
      setMessage('حدث خطأ: ' + (err.message || 'يُرجى التحقق من اتصال الإنترنت'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white dir-rtl" dir="rtl">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
        <h2 className="text-2xl font-bold text-center mb-6 text-blue-400">
          📝 إنشاء حساب جديد - EduTrack
        </h2>

        {message && (
          <div className={`p-3 rounded-lg text-center mb-4 text-sm font-medium ${isSuccess ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-500/30'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          
          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">الاسم الكامل</label>
            <input
              type="text"
              name="name"
              required
              autoComplete="off"
              value={formData.name}
              onChange={handleChange}
              placeholder="أدخل اسمك بالكامل"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">البريد الإلكتروني</label>
            <input
              type="email"
              name="email"
              required
              autoComplete="off"
              value={formData.email}
              onChange={handleChange}
              placeholder="@gmail.com"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left dir-ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">رقم الهاتف</label>
            <input
              type="text"
              name="phone"
              required
              autoComplete="off"
              value={formData.phone}
              onChange={handleChange}
              placeholder="***********"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left dir-ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">كلمة المرور</label>
            <input
              type="password"
              name="password"
              required
              autoComplete="new-password"
              minLength={6}
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-left dir-ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-300">نوع الحساب (الدور)</label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-slate-200"
            >
              <option value="student">🎓 طالب (Student)</option>
              <option value="teacher">👨‍🏫 معلم (Teacher)</option>
              <option value="parent">👨‍👩‍👦 ولي أمر (Parent)</option>
              <option value="admin">🛡️ أدمن / إدارة السنتر (Admin)</option>
            </select>
          </div>

          {(formData.role === 'admin' || formData.role === 'teacher') && (
            <div>
              <label className="block text-sm font-medium mb-1 text-yellow-400">
                🔑 كود تفعيل الصلاحية (خاص بالسنتر)
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={secretCode}
                onChange={(e) => setSecretCode(e.target.value)}
                placeholder="أدخل كود السنتر لتأكيد دورك"
                className="w-full p-3 bg-slate-900 border border-yellow-500/50 rounded-lg focus:outline-none focus:border-yellow-500 text-slate-200"
              />
            </div>
          )}

          {formData.role === 'student' && (
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-300">السنة الدراسية</label>
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
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition duration-200 shadow-lg shadow-blue-600/30"
          >
            {loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب'}
          </button>
        </form>

        <p className="text-xs text-center text-slate-400 mt-6">
          لديك حساب بالفعل؟ <a href="/login" className="text-blue-400 underline">تسجيل الدخول</a>
        </p>
      </div>
    </div>
  )
}