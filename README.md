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

## 🗄️ إعداد قاعدة البيانات (Supabase Database Setup & Migrations)

### 1. إعداد قاعدة بيانات جديدة (Fresh Database Setup)
نفّذ الملف التالي في **Supabase SQL Editor**:
- `supabase/migrations/20261103_edutrack_schema.sql`
  - ينشئ الجداول: `profiles`, `groups`, `teachers`, `students`, `attendance`, `grades`, `teacher_notes`, `activity_logs`.
  - يفعّل سياسات حماية صارمة (Row Level Security - RLS) تمنع الوصول غير المصرح به بدون دور `admin`.
  - يمنع رفع الصلاحيات الذاتي للمستخدمين عبر Trigger `trg_prevent_self_role_escalation`.
  - يحدّث تلقائياً عداد الطلاب في المجموعة `enrolled_count`.

### 2. ترقية قاعدة بيانات موجودة مسبقاً (Non-Destructive Upgrade)
إذا كانت قاعدة البيانات تحتوي بالفعل على بيانات ومخطط سابق، نفّذ ملف الترقية دون فقدان أو مسح أي بيانات:
- `supabase/migrations/20261117_edutrack_admin_auth_upgrade.sql`
  - يسقط السياسات المتساهلة القديمة (`USING (true)`).
  - ينشئ دالة `public.is_admin()` الآمنة بـ `SECURITY DEFINER` لمنع الـ Recursion.
  - يطبق سياسات RLS الصارمة ويحمي جدول `profiles`.

### 3. البيانات التجريبية الاختيارية (Optional Demo Seed Data)
لإدخال بيانات تجريبية متوافقة تماماً مع معايير RFC 4122 UUID وبدون تكرار:
- `supabase/migrations/20261103_edutrack_seed.sql`
  - يستخدم بنية `ON CONFLICT DO NOTHING` لضمان إمكانية تكرار التنفيذ بأمان.
  - يملأ بيانات تجريبية للمجموعات والطلاب والمعلمين.

---

## 🔐 إنشاء وتعيين حساب الأدمن الأولي (Secure Admin Provisioning)

لضمان الأمان الكامل، لا يحتوي كود المتصفح على أي `service_role` key ولا يسمح بالتسجيل العام بصلاحية أدمن.

1. ادخل إلى **Supabase Dashboard** -> **Authentication** -> **Users** -> **Add User**.
2. اختر **Create User** وأدخل البريد وكلمة المرور (مثال: `admin@edutrack.com`).
3. انسخ الـ **User UID** الذي تم إنشاؤه.
4. افتح **SQL Editor** في Supabase ونفذ الاستعلام التالي لربط المستخدم بدور الأدمن:

```sql
INSERT INTO public.profiles (id, email, full_name, role)
VALUES ('<USER_UID_HERE>', 'admin@edutrack.com', 'System Administrator', 'admin')
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

---

## 🚀 تشغيل واختبار المشروع محلياً (Local Setup & Verification)

### 1. تثبيت الحزم (Dependencies):
```bash
npm install
```

### 2. إعداد متغيرات البيئة (Environment Variables):
انسخ ملف `.env.example` إلى `.env`:
```bash
cp .env.example .env
```
املأ المفاتيح الخاصة بمشروعك في Supabase:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
*(ملاحظة: إذا كانت المفاتيح غير معينة أو تحتوي على القيم الافتراضية، سيعرض التطبيق شاشة تنبيه واضحة `UnconfiguredNotice` توضح خطوات الربط).*

### 3. تشغيل الاختبارات الآلية (Automated Tests):
تم إعداد حزم اختبار شاملة باستخدام **Vitest**:
```bash
npm test
```
تشمل الاختبارات التحقق من:
- `adminService.test.ts`: جلب الطلاب والمجموعات، منع البيانات الوهمية (Mock data) في الوضع الحي، معالجة كود الطالب المكرر، حفظ `group_id` بشكل صحيح.
- `authAndRoles.test.ts`: التحقق من منطق الصلاحيات وحماية الأدمن ورفض الأدوار الأخرى.
- `databaseMigrations.test.ts`: فحص ملفات الـ SQL والتأكد من صحة الـ UUIDs وغياب الـ `USING (true)` المتساهل.
- `adminFlow.test.ts`: محاكاة تدفق الأدمن الكامل من تسجيل الدخول إلى إضافة الطالب والتأكيد.

### 4. بناء المشروع للإنتاج (Production Build):
```bash
npm run build
```

### 5. تشغيل خادم التطوير (Dev Server):
```bash
npm run dev
```

---

## 📱 مخرجات أعضاء الفريق المدمجة (Integrated Team Components)

- **لوحة تحكم ولي الأمر (`ParentDashboard.tsx` - يوسف القاضي):** متوفرة ومربوطة بنظام ألوان الـ Parent Portal ولوحة المعلم.
- **كروت الطلاب ونظام الـ QR (`Qr code/` - عبد الرحمن خضري):** كروت تعريف الطلاب المزودة بـ QR Code.
- **لوحات الشرف والتصميم (`UI-UX/` - مينا أيمن):** ملفات وتصميمات الشاشات الست المعتمدة.
