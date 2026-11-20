# ابدأ من هنا — فريق EduTrack

Repository: https://github.com/mohamedwaellll/edutrack-app

نقطة البداية المخططة: tag `team-start-20261120` بعد نشر الحزمة. اقرأ HANDOFF_STATUS لمعرفة ما تم نشره فعلًا.
التطبيق المعتمد في جذر المستودع React/Vite. لا تستخدم نسخة Next.js من فرع ali كقاعدة ولا تدمجه مباشرة.
النسخة بداية تطوير؛ تصحيحات إدارة المدرسين والأدوار ما زالت مفتوحة.

## التشغيل

Node 26.8.1 هو إصدار التحقق المحلي والحزم الحالية. إعدادات الحزم قد لا تعمل على Node 20.

```powershell
git clone https://github.com/mohamedwaellll/edutrack-app.git
cd edutrack-app
git fetch origin --tags
git switch --track origin/feature/student-portal
npm ci
```

استبدل فرع الطالب بفرعك من الجدول. إذا لم تكن فروع الفريق منشورة بعد، لا تبدأ من الفرع القديم: انتظر تأكيد محمد.
انسخ .env.example إلى .env فقط إذا لم يوجد .env، وضع إعدادات مشروع Supabase للتطوير التي يوفرها المسؤول. لا ترفع ملفات الأسرار.

```powershell
npm test
npm run build
npm run dev
```

| الشخص | الفرع | التكليف |
|---|---|---|
| علي | `feature/auth-role-access` | [البرومبت](prompts/ALI.md) |
| عبدالرحمن | `feature/attendance-qr` | [البرومبت](prompts/ABDELRAHMAN.md) |
| مينا | `feature/student-portal` | [البرومبت](prompts/MINA.md) |
| يوسف | `feature/parent-portal` | [البرومبت](prompts/YOUSSEF.md) |
| محمد | `feature/admin-teacher-workflows` | [البرومبت](prompts/MOHAMED.md) |

## ترتيب العمل والدمج

1. محمد يصحح إدارة المدرسين، وعلي يعتمد العقد معه بالتوازي.
2. عبدالرحمن يثبت QR، ومينا ويوسف يجهزان البوابات واختباراتها المعزولة وفق العقد.
3. تدمج تصحيحات محمد ثم أساس الصلاحيات والروابط من علي.
4. الأعضاء يحدثون فروعهم ثم يكملون الربط الحي.
5. محمد يدمج PR واحدًا إلى develop، ويختبره قبل التالي. main للإصدار المجرب بعد نقطة البداية.

قبل التسليم، احفظ عملك في commit ثم:

```powershell
git fetch origin
git merge origin/develop
npm test
npm run build
git status
```

لا تستخدم force push أو reset --hard. راجع التعارضات مع مالك الملف. ارفع ملفات مهمتك فقط وافتح PR إلى develop.
دعوات المتعاونين وحماية الفروع إعدادات منفصلة يتأكد منها محمد؛ تجهيز الملفات لا يعني تفعيلها.

راجع TEAM_OWNERSHIP.md وINTEGRATION_CONTRACT.md وACCEPTANCE_CHECKLIST.md.
