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

## 🗄️ إعداد قاعدة البيانات والترقيات (Supabase Database Migrations)

يتبع المشروع معايير Supabase القياسية لضمان فرادة أرقام الميجريشن وفصل البيانات التجريبية عن سلسلة الترحيل التلقائي:

```
supabase/
├── migrations/
│   ├── 20261103_edutrack_schema.sql           # مخطط قاعدة البيانات الأساسي وسياسات RLS
│   └── 20261117_edutrack_admin_auth_upgrade.sql  # ترقية غير مدمرة للأنظمة القائمة
└── seed.sql                                   # بيانات تجريبية اختيارية قابلة للتكرار بأمان
```

### 1. إعداد قاعدة بيانات جديدة (Fresh Database Setup)
نفّذ الملف التالي في **Supabase SQL Editor**:
- `supabase/migrations/20261103_edutrack_schema.sql`
  - ينشئ الجداول: `profiles`, `groups`, `teachers`, `students`, `attendance`, `grades`, `teacher_notes`, `activity_logs`.
  - يفعّل سياسات حماية صارمة (Row Level Security - RLS) تمنع الوصول غير المصرح به بدون دور `admin`.
  - يمنع رفع الصلاحيات الذاتي للمستخدمين عبر Trigger `tr_check_profile_role` و `tr_check_profile_role_insert`.
  - يحدّث تلقائياً عداد الطلاب في المجموعة `enrolled_count` عبر `tr_sync_group_enrolled_count`.

### 2. ترقية قاعدة بيانات موجودة مسبقاً (Non-Destructive Upgrade)
إذا كانت قاعدة البيانات تحتوي بالفعل على بيانات ومخطط سابق، نفّذ ملف الترقية دون فقدان أو مسح أي بيانات:
- `supabase/migrations/20261117_edutrack_admin_auth_upgrade.sql`
  - يسقط السياسات المتساهلة القديمة (`USING (true)`).
  - ينشئ دالة `public.is_admin()` الآمنة بـ `SECURITY DEFINER` لمنع الـ Recursion.
  - يطبق سياسات RLS الصارمة ويحمي جدول `profiles` من الترقية الذاتية.

### 3. البيانات التجريبية الاختيارية (Optional Repeatable Demo Seed)
ملف البيانات التجريبية مفصول تماماً خارج سلسلة الميجريشن التلقائية في المسار القياسي `supabase/seed.sql`:
- يستخدم معرّفات حتمية (Deterministic RFC 4122 UUIDs) وربطاً ديناميكياً بالمفاتيح الأجنبية (`(SELECT id FROM public.groups WHERE name = ...)`).
- آمن 100% للتكرار: تنفيذ الملف عدة مرات لا ينشئ أي سجلات مكررة بفضل حراس `ON CONFLICT`.
- يحافظ على بيانات المعلمين والطلاب الحاليين حتى لو كانت معرفاتهم مختلفة.

---

## 🔐 تعيين وترقية حساب الأدمن (Secure Admin Provisioning)

لضمان الأمان الكامل، لا يحتوي كود المتصفح على أي `service_role` key ولا يسمح بالتسجيل العام بصلاحية أدمن.

### الخطوة 1: إنشاء الحساب في Supabase Auth
1. ادخل إلى **Supabase Dashboard** -> **Authentication** -> **Users** -> **Add User**.
2. اختر **Create User** وأدخل البريد وكلمة المرور (مثال: `admin@edutrack.com`).
3. انسخ الـ **User UID** الذي تم إنشاؤه.

### الخطوة 2: منح صلاحية الأدمن في SQL Editor
تم توفير إجراءين آمنين يتعاملان بسلاسة مع الحالتين:
- **الحالة (أ): مستخدم Auth ليس له ملف تعريف (Profile) مسبق** -> ينشئ الملف بصلاحية `admin`.
- **الحالة (ب): مستخدم Auth يمتلك ملف تعريف مسبق برتبة أخرى (مثل `student` أو `teacher`)** -> يرقيه إلى `admin`.

#### الخيار الأول (عبر الدالة المخزنة الآمنة):
```sql
SELECT public.provision_admin('<USER_UID_HERE>', 'admin@edutrack.com', 'System Administrator');
```

#### الخيار الثاني (عبر استعلام SQL المباشر):
```sql
INSERT INTO public.profiles (id, email, full_name, role)
VALUES ('<USER_UID_HERE>', 'admin@edutrack.com', 'System Administrator', 'admin')
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  updated_at = NOW();
```

> **ملاحظة أمنية**: تم سحب صلاحية تنفيذ `public.provision_admin` من أدوار المتصفح (`anon` و `authenticated`)، كما ترفض التريجرات وقواعد RLS أي محاولة من العميل لتعديل الرتبة إلى `admin` برمجياً من الفرونت إند.

---

## 🚀 تشغيل واختبار المشروع محلياً (Local Setup & Verification)

### 1. تثبيت الحزم (Dependencies):
```cmd
npm install
```

### 2. إعداد متغيرات البيئة (Environment Variables):
انسخ ملف `.env.example` إلى `.env`:
```cmd
copy .env.example .env
```
املأ المفاتيح الخاصة بمشروعك في Supabase:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
*(ملاحظة: إذا كانت المفاتيح غير معينة أو تحتوي على القيم الافتراضية، سيعرض التطبيق شاشة تنبيه واضحة `UnconfiguredNotice` توضح خطوات الربط).*

### 3. تشغيل الاختبارات الآلية (Automated Tests):
تم إعداد 6 حزم اختبار شاملة (30 اختباراً مؤكداً) تشمل محرك PostgreSQL حقيقي ومكونات React:
```cmd
npm test
```
تشمل الاختبارات:
- `databaseExecution.test.ts` (6 اختبارات): اختبارات محرك PostgreSQL حقيقي (Isolated WebAssembly PG Engine) تنفذ الـ SQL فعلياً وتتحقق من الترقية، وتعيين الأدمن بالحالتين، وحماية RLS، ومنع رفع الرتب الذاتي، وتكرار الـ Seed دون تدبيل.
- `authProvider.test.tsx` (5 اختبارات): اختبارات مكونات حقيقية لـ `AuthProvider` وبوابات الوصول، تتحقق من استرجاع الجلسة، وإلغاء الاستجابات المتأخرة عند تسجيل الخروج، وتفادي سباق الطلبات عند تبديل الحسابات، والتمييز الصريح بين فشل الشبكة وغياب البروفايل، وسحب الصلاحية عند تغيير الرتبة.
- `adminService.test.ts` (7 اختبارات): اختبارات وحدة لمنطق خدمات الأدمن واسترجاع المصفوفات الفارغة والتأكد من حفظ `group_id`.
- `authAndRoles.test.ts` (5 اختبارات): اختبارات وحدة لآلة حالات بوابات الوصول.
- `databaseMigrations.test.ts` (6 اختبارات): فحص استاتيكي لملفات الـ SQL وفرادة الإصدارات وغياب الـ `USING (true)`.
- `adminFlow.test.ts` (1 اختبار): محاكاة تدفق الأدمن الكامل من تسجيل الدخول إلى إضافة الطالب والتأكيد.

### 4. بناء المشروع للإنتاج (Production Build):
```cmd
npm run build
```

### 5. تشغيل خادم التطوير (Dev Server):
```cmd
npm run dev
```

---

## 📱 مخرجات أعضاء الفريق المدمجة (Integrated Team Components)

- **لوحة تحكم ولي الأمر (`ParentDashboard.tsx` - يوسف القاضي):** متوفرة ومربوطة بنظام ألوان الـ Parent Portal ولوحة المعلم.
- **كروت الطلاب ونظام الـ QR (`Qr code/` - عبد الرحمن خضري):** كروت تعريف الطلاب المزودة بـ QR Code.
- **لوحات الشرف والتصميم (`UI-UX/` - مينا أيمن):** ملفات وتصميمات الشاشات الست المعتمدة.
