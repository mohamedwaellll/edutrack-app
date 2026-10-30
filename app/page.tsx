import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col justify-center items-center p-6 text-center">
      <div className="max-w-2xl">
        <h1 className="text-5xl font-extrabold mb-4 text-blue-500">
          EduTrack 📚
        </h1>
        <p className="text-xl text-slate-300 mb-8">
          منصتك الذكية لإدارة المتابعة التعليمية والدروس بسهولة وفاعلية.
        </p>
        <div className="flex gap-4 justify-center">
          <button className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition">
            ابدأ الآن
          </button>
          <button className="border border-slate-700 hover:bg-slate-800 px-6 py-3 rounded-lg font-bold transition">
            تسجيل الدخول
          </button>
        </div>
      </div>
    </main>
  )
}
