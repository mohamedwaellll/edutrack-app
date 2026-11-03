# 🛠️ دليل محمد وائل الكامل لإعداد GitHub وإدارة فروع فريق EduTrack

مرحباً يا محمد! هذا الدليل مصمم خصيصاً لمهمتك الرسمية كمسؤول الـ **GitHub & Admin**:
1. إنشاء وإعداد الـ Repository ودعوة الفريق.
2. هندسة الفروع (Branching Strategy).
3. إعداد قواعد الحماية (Branch Protection Rules).
4. طريقة إدارة وقبول الـ Pull Requests ودمج الكود بدون أي تضارب (Conflict-free).

---

## 1. خطوات إنشاء المستودع على GitHub ودعوة التيم

### أ. إنشاء المستودع (GitHub Repository):
1. افتح حسابك على [GitHub](https://github.com) واضغط على زر **New Repository**.
2. اسم المستودع: `edutrack-portal` أو `edutrack`.
3. النوع: **Public** أو **Private**.
4. لا تقم بإنشاء README أو .gitignore من المتصفح لأننا قمنا بتجهيزها لك بالكامل داخل مجلد المشروع!
5. اضغط **Create repository**.

### ب. ربط ورفع الكود من جهازك إلى GitHub:
افتح الـ Terminal / PowerShell داخل مجلد `edutrack-portal` ونفذ الأوامر التالية:

```bash
git init
git add .
git commit -m "feat: initial commit with admin dashboard, teacher hub, supabase schema and github templates"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/edutrack-portal.git
git push -u origin main
```

### ج. دعوة أعضاء الفريق (Invite Collaborators):
1. ادخل على المستودع على GitHub: **Settings** -> **Collaborators**.
2. اضغط على **Add people**.
3. ابحث عن حسابات زملائك وقم بإرسال الدعوات:
   - **علي عبد القادر** (Team Leader)
   - **عبد الرحمن خضري** (QR Systems)
   - **مينا أيمن** (UI/UX & Student)
   - **يوسف القاضي** (Parent & Analytics)

---

## 2. هيكلة الفروع (Branching Strategy)

لضمان عدم حدوث تضارب في الكود (Merge Conflicts)، سنعتمد استراتيجية **Git Flow** الاحترافية:

```
[main] (النسخة النهائية المستقرة والجاهزة للتسليم والعرض)
   │
   └── [develop] (الفرع التجميعي لجميع ميزات التيم)
          ├── feature/auth-supabase        (علي عبد القادر)
          ├── feature/admin-dashboard      (محمد وائل)
          ├── feature/teacher-dashboard    (محمد وائل)
          ├── feature/student-qr           (عبد الرحمن خضري)
          ├── feature/student-ui           (مينا أيمن)
          └── feature/parent-analytics     (يوسف القاضي)
```

### أوامر إنشاء الفروع الأساسية على جهازك ورفعها:
```bash
# إنشاء فرع develop والرفع
git checkout -b develop
git push -u origin develop

# إنشاء فروع الميزات لأعضاء الفريق
git checkout -b feature/auth-supabase
git push -u origin feature/auth-supabase

git checkout -b feature/admin-dashboard
git push -u origin feature/admin-dashboard

git checkout -b feature/teacher-dashboard
git push -u origin feature/teacher-dashboard

git checkout -b feature/student-qr
git push -u origin feature/student-qr

git checkout -b feature/student-ui
git push -u origin feature/student-ui

git checkout -b feature/parent-analytics
git push -u origin feature/parent-analytics

# الرجوع لفرع develop
git checkout develop
```

---

## 3. إعداد قواعد حماية الفروع (Branch Protection Rules)

لحماية فرعي `main` و `develop` من التعديل العشوائي أو المباشر:

1. من صفحة المستودع: **Settings** -> **Branches** -> **Add branch protection rule**.
2. في خانة **Branch name pattern** اكتب: `main`
   - [x] فعل: **Require a pull request before merging**
   - [x] فعل: **Require approvals** (حدد 1 على الأقل - محمد وائل أو علي عبد القادر)
   - [x] فعل: **Require status checks to pass before merging** (اختر `build-and-lint` الخاص بـ GitHub Actions)
3. كرر نفس الخطوة لفرع `develop`.

---

## 4. إرشادات العمل اليومية لأعضاء التيم (شاركها مع زملائك)

عندما يبدأ أي زميل في كتابة الكود الخاص بمهمته:
1. يعمل فقط داخل الفرع المخصص له (مثلاً `feature/student-qr`).
2. قبل عمل Push، يسحب آخر التحديثات من `develop`:
   ```bash
   git pull origin develop
   ```
3. يقوم بعمل Commit و Push:
   ```bash
   git add .
   git commit -m "feat(qr): add attendance camera scanner logic"
   git push origin feature/student-qr
   ```
4. يفتح **Pull Request (PR)** من فرعه إلى فرع `develop` وليس `main` مباشرة.

---

## 5. دور محمد وائل في مراجعة ودمج الـ Pull Requests (الأسبوع الثاني والثالث)

1. افتح تبويب **Pull Requests** على GitHub.
2. ستجد قالب الفحص التلقائي الذي جهزناه (`PULL_REQUEST_TEMPLATE.md`).
3. تأكد من:
   - اخضرار الـ CI Build (`All checks have passed`).
   - عدم وجود ملفات خارج نطاق مهمة الزميل.
   - عدم وجود ملفات حساسة مثل مفاتيح الـ API السرية.
4. اضغط **Approve** ثم **Merge Pull Request** (يفضل اختيار `Squash and merge` للحفاظ على سجل Git نظيفاً).
5. في نهاية الأسبوع الثالث، يتم فتح PR واحد من `develop` إلى `main` بعد الاختبار الشامل ليصبح المشروع جاهزاً للتسليم بنسبة 100%.
