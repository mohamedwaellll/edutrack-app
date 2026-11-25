import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePreferences } from "../contexts/preferencesState";
import { BrandMark } from "./BrandMark";
import { DisplayControls } from "./DisplayControls";

const subjectProgress = [
  { subject: "Math", arSubject: "رياضيات", score: 84 },
  { subject: "Science", arSubject: "علوم", score: 94 },
  { subject: "English", arSubject: "إنجليزي", score: 89 },
  { subject: "History", arSubject: "تاريخ", score: 91 },
  { subject: "Coding", arSubject: "برمجة", score: 96 },
];

const reports = [
  { enTitle: "Mid-Term Progress Report", arTitle: "تقرير تقدم الفصل الدراسي", enDate: "Oct 24, 2026", arDate: "٢٤ أكتوبر ٢٠٢٦", enType: "Progress", arType: "تقدم دراسي" },
  { enTitle: "Science Lab Evaluation", arTitle: "تقييم مادة العلوم", enDate: "Oct 21, 2026", arDate: "٢١ أكتوبر ٢٠٢٦", enType: "Assessment", arType: "تقييم" },
  { enTitle: "Monthly Attendance Summary", arTitle: "ملخص الحضور الشهري", enDate: "Oct 12, 2026", arDate: "١٢ أكتوبر ٢٠٢٦", enType: "Attendance", arType: "حضور" },
];

const activities = [
  { enDate: "Nov 2", arDate: "٢ نوفمبر", enTitle: "Science Project Showcase", arTitle: "عرض مشروع العلوم" },
  { enDate: "Nov 5", arDate: "٥ نوفمبر", enTitle: "Mathematics Quiz", arTitle: "اختبار الرياضيات" },
  { enDate: "Nov 8", arDate: "٨ نوفمبر", enTitle: "Parent-Teacher Meeting", arTitle: "اجتماع ولي الأمر والمعلم" },
];

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: string }) {
  return (
    <article className="rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-[0_4px_18px_rgba(31,49,43,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#7B8794] dark:text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#26334A] dark:text-white">{value}</p>
          <p className="mt-2 text-xs text-[#174E50] dark:text-teal-300">{hint}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#D8E8DC] dark:bg-teal-950/60 text-xl text-[#174E50] dark:text-teal-300" aria-hidden="true">{icon}</span>
      </div>
    </article>
  );
}

export default function ParentDashboard() {
  const { language, isRtl, isDark, t } = usePreferences();

  const navItems =
    language === "ar"
      ? ["الرئيسية", "الحضور", "الأداء الدراسي", "التقارير", "الأنشطة"]
      : ["Overview", "Attendance", "Academics", "Reports", "Activities"];

  const chartData = subjectProgress.map((item) => ({
    label: language === "ar" ? item.arSubject : item.subject,
    score: item.score,
  }));

  return (
    <div dir={isRtl ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] font-sans text-[#26334A] dark:text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 flex-col border-e border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#0E1621] px-5 py-7 lg:flex">
          <a href="#home" className="mb-10 flex items-center gap-3 text-xl font-extrabold tracking-tight text-[#26334A] dark:text-white">
            <BrandMark className="w-8 h-8" />
            {t("brandName")}
          </a>
          <p className="mb-3 px-3 text-xs font-semibold text-[#9AA39C] dark:text-slate-400">{t("pdParentAccountLabel")}</p>
          <nav className="space-y-1" aria-label="Main navigation">
            {navItems.map((item, index) => (
              <a key={item} href={`#section-${index}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${index === 0 ? "bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-200" : "text-[#7B8794] dark:text-slate-400 hover:bg-[#F8F7F2] dark:hover:bg-slate-800"}`}>
                <span className="w-5 text-center" aria-hidden="true">{["⌂", "◷", "▥", "▤", "◇"][index]}</span>{item}
              </a>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl bg-[#F8F7F2] dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 p-4">
            <p className="text-sm font-bold">{t("pdHelpQuestion")}</p>
            <p className="mt-1 text-xs leading-5 text-[#7B8794] dark:text-slate-400">{t("pdHelpBody")}</p>
            <p className="mt-3 text-xs font-bold text-[#174E50] dark:text-teal-300">{t("pdHelpContact")}</p>
          </div>
        </aside>

        <main id="home" className="min-w-0 flex-1 px-4 py-5 sm:px-7 lg:px-10 lg:py-8">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-[#7B8794] dark:text-slate-400">{t("pdParentSpace")}</p>
                <span className="rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 px-2.5 py-1 text-[11px] font-semibold text-[#174E50] dark:text-teal-200">{t("pdSampleBadge")}</span>
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{t("pdMainHeading")}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DisplayControls variant="surface" />
              <div className="flex items-center gap-3 rounded-full border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#131E2B] py-1.5 px-3 text-start">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 text-sm font-bold text-[#174E50] dark:text-teal-200">
                  {language === "ar" ? "أم" : "PM"}
                </span>
                <span>
                  <span className="block text-sm font-bold">{language === "ar" ? "أم مينا" : "Om Mina"}</span>
                  <span className="block text-xs text-[#7B8794] dark:text-slate-400">{t("pdParentRole")}</span>
                </span>
              </div>
            </div>
          </header>

          <section id="section-0" className="mb-6 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-xs sm:flex sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#D8E8DC] dark:bg-teal-950/70 text-lg font-bold text-[#174E50] dark:text-teal-200">
                {language === "ar" ? "ل هـ" : "LH"}
              </div>
              <div>
                <p className="text-lg font-extrabold">{language === "ar" ? "لارا حسن" : "Lara Hassan"}</p>
                <p className="mt-1 text-sm text-[#7B8794] dark:text-slate-400">
                  {language === "ar" ? "الصف الثامن أ · كود الطالب ET-2048" : "Grade 8A · Student Code ET-2048"}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 px-4 py-2 text-sm font-bold text-[#174E50] dark:text-teal-200 sm:mt-0">{t("pdOverallProgress")}</div>
          </section>

          <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Student metrics">
            <StatCard label={t("pdAttendanceRate")} value="96.8%" hint={t("pdExcellentTerm")} icon="◷" />
            <StatCard label={t("pdAverageScore")} value="91.4%" hint={t("pdTrendHint")} icon="↗" />
            <StatCard label={t("pdAssignments")} value="18 / 20" hint={t("pdPendingAssignments")} icon="▤" />
            <StatCard label={t("pdGoalCompletion")} value="67%" hint={t("pdSteadyProgress")} icon="☆" />
          </section>

          <section className="mb-6 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <article id="section-2" className="rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-xs sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold">{t("pdAcademicPerfTitle")}</h2>
                  <p className="mt-1 text-xs text-[#7B8794] dark:text-slate-400">{t("pdAcademicPerfSub")}</p>
                </div>
                <span className="rounded-lg border border-[#E6E8E2] dark:border-slate-700 px-3 py-2 text-xs font-semibold text-[#7B8794] dark:text-slate-300">
                  {t("pdCurrentTermBtn")}
                </span>
              </div>
              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={isDark ? "#1E293B" : "#E6E8E2"} vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: isDark ? "#94A3B8" : "#7B8794", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: isDark ? "#94A3B8" : "#9AA39C", fontSize: 10 }} />
                    <Tooltip
                      cursor={{ fill: isDark ? "#1E293B" : "#F8F7F2" }}
                      contentStyle={{
                        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
                        borderColor: isDark ? "#334155" : "#E6E8E2",
                        color: isDark ? "#F8FAFC" : "#26334A",
                        borderRadius: "10px",
                      }}
                      formatter={(value) => [`${value}%`, t("scoreLabel")]}
                    />
                    <Bar dataKey="score" fill={isDark ? "#2DD4BF" : "#174E50"} radius={[7, 7, 0, 0]} maxBarSize={34} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-xs sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">{t("pdTeacherNotesTitle")}</h2>
                  <p className="mt-1 text-xs text-[#7B8794] dark:text-slate-400">{t("pdLatestFollowup")}</p>
                </div>
                <span className="rounded-full bg-[#F8F7F2] dark:bg-slate-800 px-2.5 py-1 text-xs text-[#7B8794] dark:text-slate-300">
                  {language === "ar" ? "٢٤ أكتوبر" : "Oct 24"}
                </span>
              </div>
              <div className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#D8E8DC] dark:bg-teal-950/70 font-bold text-[#174E50] dark:text-teal-200">
                    {language === "ar" ? "سف" : "SF"}
                  </span>
                  <div>
                    <p className="text-sm font-bold">{language === "ar" ? "د. سلمى فريد" : "Dr. Salma Farid"}</p>
                    <p className="text-xs text-[#7B8794] dark:text-slate-400">{language === "ar" ? "معلمة العلوم" : "Science Teacher"}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 text-[#7B8794] dark:text-slate-300">
                  {language === "ar"
                    ? "لارا بتُظهر فضولًا ومشاركة مميزة في حصة العلوم. مستواها بيتحسن باستمرار، خصوصًا في التجارب العملية."
                    : "Lara demonstrates strong curiosity and active participation in science sessions, especially during lab exercises."}
                </p>
                <a href="#section-3" className="mt-3 inline-block text-xs font-bold text-[#174E50] dark:text-teal-300">
                  {t("pdViewFullReport")}
                </a>
              </div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article id="section-3" className="rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-xs sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">{t("pdRecentReportsTitle")}</h2>
                  <p className="mt-1 text-xs text-[#7B8794] dark:text-slate-400">{t("pdStudentFilesSub")}</p>
                </div>
                <a href="#reports" className="text-xs font-bold text-[#174E50] dark:text-teal-300">{t("pdAllReportsLink")}</a>
              </div>
              <div className="divide-y divide-[#E6E8E2] dark:divide-slate-800">
                {reports.map((report) => (
                  <a key={report.enTitle} href="#reports" className="flex items-center justify-between gap-3 py-3 first:pt-1">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#D8E8DC] dark:bg-teal-950/70 text-[#174E50] dark:text-teal-300">▤</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{language === "ar" ? report.arTitle : report.enTitle}</span>
                        <span className="mt-1 block text-xs text-[#7B8794] dark:text-slate-400">{language === "ar" ? report.arType : report.enType}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-[#7B8794] dark:text-slate-400">{language === "ar" ? report.arDate : report.enDate}</span>
                  </a>
                ))}
              </div>
            </article>
            <article id="section-4" className="rounded-2xl border border-[#E6E8E2] dark:border-slate-800 bg-white dark:bg-[#131E2B] p-5 shadow-xs sm:p-6">
              <div className="mb-4">
                <h2 className="font-extrabold">{t("pdUpcomingActivitiesTitle")}</h2>
                <p className="mt-1 text-xs text-[#7B8794] dark:text-slate-400">{t("pdImportantDatesSub")}</p>
              </div>
              <div className="space-y-3">
                {activities.map((activity) => (
                  <div key={activity.enTitle} className="flex items-center gap-3 rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] p-3">
                    <span className="min-w-[68px] rounded-lg bg-white dark:bg-slate-800 px-2 py-2 text-center text-xs font-bold text-[#174E50] dark:text-teal-300">
                      {language === "ar" ? activity.arDate : activity.enDate}
                    </span>
                    <p className="text-sm font-semibold">{language === "ar" ? activity.arTitle : activity.enTitle}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
          <footer className="py-7 text-center text-xs text-[#9AA39C] dark:text-slate-500">{t("pdFooterNote")}</footer>
        </main>
      </div>
    </div>
  );
}
