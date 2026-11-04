import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const subjectProgress = [
  { subject: "رياضيات", score: 84 },
  { subject: "علوم", score: 94 },
  { subject: "إنجليزي", score: 89 },
  { subject: "تاريخ", score: 91 },
  { subject: "برمجة", score: 96 },
];

const reports = [
  { title: "تقرير تقدم الفصل الدراسي", date: "٢٤ أكتوبر ٢٠٢٦", type: "تقدم دراسي" },
  { title: "تقييم مادة العلوم", date: "٢١ أكتوبر ٢٠٢٦", type: "تقييم" },
  { title: "ملخص الحضور الشهري", date: "١٢ أكتوبر ٢٠٢٦", type: "حضور" },
];

const activities = [
  { date: "٢ نوفمبر", title: "عرض مشروع العلوم" },
  { date: "٥ نوفمبر", title: "اختبار الرياضيات" },
  { date: "٨ نوفمبر", title: "اجتماع ولي الأمر والمعلم" },
];

const navItems = ["الرئيسية", "الحضور", "الأداء الدراسي", "التقارير", "الأنشطة"];

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: string }) {
  return (
    <article className="rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#7B8794]">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#26334A]">{value}</p>
          <p className="mt-2 text-xs text-[#174E50]">{hint}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#D8E8DC] text-xl text-[#174E50]" aria-hidden="true">{icon}</span>
      </div>
    </article>
  );
}

export default function ParentDashboard() {
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-[#F8F7F2] font-sans text-[#26334A]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 flex-col border-l border-[#E6E8E2] bg-white px-5 py-7 lg:flex">
          <a href="#home" className="mb-10 flex items-center gap-3 text-xl font-extrabold tracking-tight text-[#26334A]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#D8E8DC] text-xl text-[#174E50]">✦</span>
            EduTrack
          </a>
          <p className="mb-3 px-3 text-xs font-semibold text-[#9AA39C]">حساب ولي الأمر</p>
          <nav className="space-y-1" aria-label="القائمة الرئيسية">
            {navItems.map((item, index) => (
              <a key={item} href={`#section-${index}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${index === 0 ? "bg-[#D8E8DC] text-[#174E50]" : "text-[#7B8794] hover:bg-[#F8F7F2]"}`}>
                <span className="w-5 text-center" aria-hidden="true">{["⌂", "◷", "▥", "▤", "◇"][index]}</span>{item}
              </a>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl bg-[#F8F7F2] p-4">
            <p className="text-sm font-bold">محتاج مساعدة؟</p>
            <p className="mt-1 text-xs leading-5 text-[#7B8794]">تواصل مع فريق الدعم لو عندك أي استفسار.</p>
            <p className="mt-3 text-xs font-bold text-[#174E50]">اسأل مسؤول المركز عن المساعدة</p>
          </div>
        </aside>

        <main id="home" className="min-w-0 flex-1 px-4 py-5 sm:px-7 lg:px-10 lg:py-8">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-[#7B8794]">مساحة ولي الأمر</p>
                <span className="rounded-full bg-[#D8E8DC] px-2.5 py-1 text-[11px] font-semibold text-[#174E50]">بيانات تجريبية</span>
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">متابعة رحلة ابنك التعليمية</h1>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" aria-label="الإشعارات" className="grid h-11 w-11 place-items-center rounded-full border border-[#E6E8E2] bg-white text-lg">♧</button>
              <button type="button" className="flex items-center gap-3 rounded-full border border-[#E6E8E2] bg-white py-1.5 pl-4 pr-1.5 text-right">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#D8E8DC] text-sm font-bold text-[#174E50]">أم</span>
                <span><span className="block text-sm font-bold">أم مينا</span><span className="block text-xs text-[#7B8794]">ولي أمر</span></span>
                <span className="text-xs text-[#7B8794]">⌄</span>
              </button>
            </div>
          </header>

          <section id="section-0" className="mb-6 rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)] sm:flex sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#D8E8DC] text-lg font-bold text-[#174E50]">ل هـ</div>
              <div><p className="text-lg font-extrabold">لارا حسن</p><p className="mt-1 text-sm text-[#7B8794]">الصف الثامن أ · رقم الطالب ET-2048</p></div>
            </div>
            <div className="mt-4 rounded-full bg-[#D8E8DC] px-4 py-2 text-sm font-bold text-[#174E50] sm:mt-0">التقدم الإجمالي ٨٧٪</div>
          </section>

          <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص الطالب">
            <StatCard label="نسبة الحضور" value="٩٦٫٨٪" hint="ممتاز · هذا الفصل" icon="◷" />
            <StatCard label="متوسط الدرجات" value="٩١٫٤٪" hint="↑ ٣٫٢٪ عن الشهر السابق" icon="↗" />
            <StatCard label="الواجبات" value="١٨ / ٢٠" hint="واجبان قيد التسليم" icon="▤" />
            <StatCard label="إنجاز الأهداف" value="٦٧٪" hint="تقدم ثابت عن الأسبوع الماضي" icon="☆" />
          </section>

          <section className="mb-6 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <article id="section-2" className="rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)] sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-extrabold">الأداء الدراسي</h2><p className="mt-1 text-xs text-[#7B8794]">نتائج المواد خلال الفصل الحالي</p></div><button className="rounded-lg border border-[#E6E8E2] px-3 py-2 text-xs font-semibold text-[#7B8794]">الفصل الحالي⌄</button></div>
              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectProgress} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#E6E8E2" vertical={false} />
                    <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{ fill: "#7B8794", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#9AA39C", fontSize: 10 }} />
                    <Tooltip cursor={{ fill: "#F8F7F2" }} formatter={(value) => [`${value}%`, "الدرجة"]} />
                    <Bar dataKey="score" fill="#174E50" radius={[7, 7, 0, 0]} maxBarSize={34} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)] sm:p-6">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-extrabold">ملاحظات المعلم</h2><p className="mt-1 text-xs text-[#7B8794]">آخر متابعة للطالب</p></div><span className="rounded-full bg-[#F8F7F2] px-2.5 py-1 text-xs text-[#7B8794]">٢٤ أكتوبر</span></div>
              <div className="rounded-xl bg-[#F8F7F2] p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#D8E8DC] font-bold text-[#174E50]">سف</span><div><p className="text-sm font-bold">د. سلمى فريد</p><p className="text-xs text-[#7B8794]">معلمة العلوم</p></div></div><p className="mt-4 text-sm leading-7 text-[#7B8794]">لارا بتُظهر فضولًا ومشاركة مميزة في حصة العلوم. مستواها بيتحسن باستمرار، خصوصًا في التجارب العملية.</p><a href="#section-3" className="mt-3 inline-block text-xs font-bold text-[#174E50]">عرض التقرير الكامل ←</a></div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article id="section-3" className="rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)] sm:p-6">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-extrabold">التقارير الأخيرة</h2><p className="mt-1 text-xs text-[#7B8794]">ملفات وتقارير الطالب</p></div><a href="#reports" className="text-xs font-bold text-[#174E50]">كل التقارير</a></div>
              <div className="divide-y divide-[#E6E8E2]">{reports.map((report) => <a key={report.title} href="#reports" className="flex items-center justify-between gap-3 py-3 first:pt-1"><span className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#D8E8DC] text-[#174E50]">▤</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{report.title}</span><span className="mt-1 block text-xs text-[#7B8794]">{report.type}</span></span></span><span className="shrink-0 text-xs text-[#7B8794]">{report.date}</span></a>)}</div>
            </article>
            <article id="section-4" className="rounded-2xl border border-[#E6E8E2] bg-white p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)] sm:p-6">
              <div className="mb-4"><h2 className="font-extrabold">الأنشطة القادمة</h2><p className="mt-1 text-xs text-[#7B8794]">مواعيد مهمة في تقويم الطالب</p></div>
              <div className="space-y-3">{activities.map((activity) => <div key={activity.title} className="flex items-center gap-3 rounded-xl bg-[#F8F7F2] p-3"><span className="min-w-[58px] rounded-lg bg-white px-2 py-2 text-center text-xs font-bold text-[#174E50]">{activity.date}</span><p className="text-sm font-semibold">{activity.title}</p></div>)}</div>
            </article>
          </section>
          <footer className="py-7 text-center text-xs text-[#9AA39C]">EduTrack · متابعة أسهل لرحلة تعليمية أفضل</footer>
        </main>
      </div>
    </div>
  );
}


