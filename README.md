# EduTrack | نسخة اختبار الفريق

EduTrack نظام لإدارة الحضور والدرجات والملاحظات والواجبات ومحادثات المجموعات، بأربع بوابات للأدمن والمدرس والطالب ووليّ الأمر.

## شغّل الديمو

فكّ ضغط الحزمة أو استنسخ فرع `feature/team-test` بالأمر أدناه، وافتح الطرفية في المجلد اللي فيه `package.json`. استخدم Node.js بالإصدار `26.8.1` المحدد في `.nvmrc`.

```sh
git clone --branch feature/team-test --single-branch https://github.com/mohamedwaellll/edutrack-app.git
```

على Windows شغّل:

```powershell
npm.cmd ci
npm.cmd run demo
```

على macOS أو Linux استخدم `npm` في الأمرين. افتح [الديمو المحلي](http://127.0.0.1:4179) بعد ظهور رسالة `EDUTRACK LOCAL DEMO READY`. الطرفية بتعرض حسابات الأدوار التجريبية وكلمة السر ومسار صورة بطاقة الطالب. الديمو يستخدم قاعدة محلية في الذاكرة ويبدأ ببيانات جديدة في كل تشغيل. اترك الطرفية مفتوحة أثناء الاختبار واضغط `Ctrl+C` للإيقاف.

## سيناريو اختبار سريع

1. ادخل كأدمن وافتح **Attendance → QR Attendance Scanner**. اختر **Physics Group F1** وارفع [بطاقة ET-F-101](scripts/demo/et-f-101-card.png) من **Upload Image**. كرّر المسح بعد أكثر من 3 ثوانٍ وتحقق من بقاء سجل واحد بنفس وقت الوصول.
2. من **Manual Roster** في نفس المجموعة والتاريخ، غيّر حالة الطالب من **Present** إلى **Absent**. حدّث العرض وتأكد إن الحالة اتحفظت ووقت الوصول اتمسح. لو هتكمل السيناريو بحالة حضور، ارجعها إلى **Present**.
3. اخرج وادخل كمدرس وسجّل للطالب `18/20` وملاحظتين، واحدة **Internal Only** والتانية **Visible to Parent**.
4. ادخل كطالب وتحقق من الحضور والدرجة. بعد كده ادخل كوليّ أمر وتأكد إن ملاحظة **Visible to Parent** وحدها بتظهر وإن البيانات بتفضل بعد تحديث الصفحة.

استخدم [دليل التيم لاختبار كل المميزات](docs/TEAM_TEST_GUIDE.md) لحسابات الدخول، وسيناريوهات الحضور والواجبات والشات والصلاحيات، وطريقة تسجيل النتائج. فيه كمان [قائمة قبول تقنية](docs/ACCEPTANCE_CHECKLIST.md) للمراجعة.

## التحقق الآلي

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

(على macOS / Linux استبدل `npm.cmd` بـ `npm`.)

## إعداد رابط استعادة كلمة المرور (Supabase Redirect URL)

عند تشغيل التطبيق مع Supabase Auth، يستدعي مسار **Forgot password?** الدالة `supabase.auth.resetPasswordForEmail(email, { redirectTo })` بعنوان رجوع ثابت تابع للتطبيق هو:

- `<APP_ORIGIN>/reset-password`

يجب إضافة عناوين الرجوع التالية في لوحة Supabase تحت **Authentication → URL Configuration → Redirect URLs** (مع ضبط **Site URL** لعنوان التطبيق الأساسي):

- التطوير المحلي: `http://localhost:3000/reset-password`
- المعاينة المحلية: `http://localhost:4173/reset-password` و`http://127.0.0.1:4179/reset-password`
- بيئة النشر الفعلية: `https://<your-domain>/reset-password`

ملاحظة: في بيئة استضافة ثابتة (SPA)، تأكد من توجيه مسار `/reset-password` إلى `index.html`. وفي الديمو المحلي (`npm.cmd run demo`) لا يدعم جسر PGlite إرسال البريد، ويتطلب اختبار الإرسال الفعلي ربط التطبيق بخدمة Supabase Auth مع خادم بريد/SMTP.

## اختبار استعادة كلمة المرور على Supabase المحلي (Docker)

يتضمن المشروع إعداد `supabase/config.toml` مضبوطًا على رابط الرجوع `http://localhost:3000/reset-password` وصندوق البريد التجريبي المحلي (`54324`). أي زميل لديه Docker وSupabase CLI يمكنه تنفيذ اختبار التكامل الكامل (بمتصفح فعلي معزول تمامًا عن `.env`) بالخطوات التالية:

```powershell
npx.cmd supabase start
npm.cmd run test:recovery:local
npx.cmd supabase stop
```

(على macOS / Linux استخدم `npx supabase` و`npm run test:recovery:local`.)

- يتوقف الاختبار فورًا برسالة صريحة إذا تم توجيهه لأي عنوان Supabase غير محلي (`127.0.0.1` / `localhost` / `::1` فقط مسموحة)، أو إذا كان المنفذ `3000` مشغولًا بخدمة أخرى (مع ترك الخدمة القائمة تعمل دون المساس بها).
- يولّد الاختبار بريدًا فريدًا لكل تشغيل وينظّف حسابه في كل الأحوال، وينفّذ: طلب الاستعادة ← استخراج الرابط الفعلي من Mailpit/Inbucket ← فتحه في تبويب جديد وحفظ كلمة جديدة ← رفض الكلمة القديمة ← الدخول بالجديدة إلى بوابة المدرس ← إعادة فتح الرابط المستعمل والتحقق من رفضه، مع حجب كلمات المرور والتوكنات والروابط الكاملة من السجلات واللقطات في `.tmp/recovery-e2e-artifacts`.

## اختبار تخزين ملفات PDF على Supabase المحلي (Docker)

بعد تشغيل `npx.cmd supabase start` وتطبيق الهجرات، يمكن التحقق من الرفع والتوقيع والتنزيل الفعلي لملفات PDF (الواجب والتسليم) ورفض غير المصرح لهم عبر:

```powershell
npm.cmd run test:storage:local
```

(على macOS / Linux استخدم `npm run test:storage:local`، ولا يقرأ السكربت `.env` ويرفض أي عنوان أو إعادة توجيه خارج `127.0.0.1` / `localhost` / `::1`.)

## اختبار محادثة المجموعات الفورية (Realtime) على Supabase المحلي (Docker)

على جهاز فيه Docker وSupabase CLI v3، شغّل Supabase المحلي وطبّق هجرات المشروع، ثم شغّل الاختبار:

```powershell
npm.cmd run test:chat:realtime
```

الاختبار يولّد حسابات ومجموعات تجريبية وينظّفها في النهاية. يستنى وصول حدث رسالة المدرّس عند الطالب وحدث رد الطالب عند المدرّس عبر WebSocket. ويختبر إن طالب المجموعة التانية يستقبل أحداث مجموعته وتترفض قراءته للشات خارجها. الاتصال مقصور على الجهاز المحلي. على macOS أو Linux استخدم `npm` بدل `npm.cmd`.

[دليل التشغيل وحالة التحقق](docs/HANDOFF_STATUS.md) · [عقد الربط وترتيب الهجرات](docs/INTEGRATION_CONTRACT.md)
