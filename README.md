# ✦ EduTrack — Cosmic Educational Platform & Management System

> **EduTrack combines a cinematic cosmic atmosphere with a calm, approachable educational interface.**  
> Designed according to the **EduTrack Cosmic Fantasy Color Catalog** & Educational Warm Palette.

---

## 👥 فريق العمل وتوزيع المهام (Team Structure)

| العضو | الدور والمسؤولية | المهام الرئيسية |
|---|---|---|
| **محمد وائل** | **GitHub & Admin & Database Architect** | • إنشاء الـ Repo وإعداد الفروع والـ CI/CD<br>• لوحة تحكم الأدمن والسنتر (`AdminDashboard.tsx`)<br>• لوحة المعلم والدرجات (`TeacherDashboard.tsx`)<br>• جداول المجموعات والدرجات في Supabase ومراجعة الـ PRs |
| **علي عبد القادر** | **Team Leader & Auth** | • إعداد مشروع Supabase وجدول المستخدمين<br>• صفحة الدخول وحماية المسارات (`AuthPage.tsx`)<br>• الدمج النهائي على الفرع الرئيسي |
| **عبد الرحمن خضري** | **QR Systems & Hardware Integration** | • تصميم كروت الطلاب بـ QR Code فريد<br>• قارئ الكاميرا وتسجيل الحضور اللحظي |
| **مينا أيمن** | **UI/UX & Student Portal** | • الهوية البصرية وتناسق الألوان<br>• لوحة تحكم الطالب (`StudentDashboard.tsx`)<br>• لوحة الشرف ونظام الأوسمة (Leaderboard & Badges) |
| **يوسف القاضي** | **Parent & Analytics** | • لوحة تحكم ولي الأمر (`ParentDashboard.tsx`)<br>• الرسوم البيانية التفاعلية (Recharts)<br>• إشعارات الحضور الفورية عبر Supabase Realtime |

---

## 🎨 الهوية البصرية ونظام الألوان (Design & Color Palette)

تم بناء وتطوير لوحات التحكم بالاعتماد على درجات ألوان الكتالوج المعتمد:
- **Admin Dashboard & Parent Portal Palette:**
  - Background: `#F8F7F2` (Off-White)
  - Cards: `#FFFFFF` (Light Card)
  - Primary Educational Buttons: `#174E50` (Dark Teal)
  - Accent / Supportive UI: `#A8BDA6` (Sage Green)
  - Soft Badges: `#D8E8DC` (Mint), `#F2EBDD` (Warm Beige)
  - Primary Text: `#26334A`
  - Secondary Text: `#7B8794`
  - Outlines / Dividers: `#E6E8E2`

---

## 🚀 تشغيل المشروع محلياً (Local Development Setup)

1. **تثبيت الحزم (Dependencies):**
```bash
npm install
```

2. **إعداد متغيرات البيئة (Environment Variables):**
انسخ ملف `.env.example` إلى `.env`:
```bash
cp .env.example .env
```
أدخل مفاتيح مشروع Supabase (المستلمة من علي عبد القادر).

3. **تشغيل خادم التطوير:**
```bash
npm run dev
```

4. **بناء المشروع للإنتاج (Production Build):**
```bash
npm run build
```

---

## 🗄️ قاعدة البيانات (Supabase Database Migrations)

ملف الـ SQL الجاهز للتنفيذ موجود في:
`supabase/migrations/20261103_edutrack_schema.sql`

يحتوي على:
- جداول `groups`, `teachers`, `students`, `attendance`, `grades`, `teacher_notes`, `activity_logs`.
- قواعد الأمان والحماية (Row Level Security - RLS).
- بيانات أولية تجريبية (Seed Data) مطابقة تماماً لشاشات التصميم (Lara Hassan, Adam Nabil, Youssef Ali, Mariam Samir, Dr. Salma Farid).

---

## 📱 مخرجات أعضاء الفريق المدمجة (Integrated Team Components)

- **لوحة تحكم ولي الأمر (`ParentDashboard.tsx` - يوسف القاضي):** متوفرة ومربوطة بنظام ألوان الـ Parent Portal ولوحة المعلم.
- **كروت الطلاب ونظام الـ QR (`Qr code/` - عبد الرحمن خضري):** كروت تعريف الطلاب المزودة بـ QR Code.
- **لوحات الشرف والتصميم (`UI-UX/` - مينا أيمن):** ملفات وتصميمات الشاشات الست المعتمدة.
