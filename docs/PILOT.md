# Онлайн-пілот «Поступу» 0.2.0

Render запускає один сервіс із Django, учнівським сайтом і адмінкою під однією HTTPS-адресою. Neon зберігає облікові записи, групи, сесії та вподобайки в PostgreSQL між розгортаннями. Windows-клієнт звертається до того самого сервісу.

## Перший запуск

1. Перевір файли коміту та відправ зміни 0.2.0 в `main`. Дочекайся зеленої перевірки **Pilot checks** у вкладці Actions. Вона збирає контейнер, перевіряє міграції, запускає тести PostgreSQL і запитує сайт, API та стилі адмінки із запущеного контейнера. [Репозиторій](https://github.com/Guardianec/studentwatch) · [GitHub Actions](https://github.com/Guardianec/studentwatch/actions)
2. Створи проєкт на тарифі **Neon Free** у найближчому до Render регіоні. У **Connect** вимкни **Connection pooling** і скопіюй пряму PostgreSQL-адресу. Збережи параметри TLS з адреси. [Консоль Neon](https://console.neon.tech/) · [Підключення до Neon](https://neon.com/docs/connect/connect-from-any-app)
3. У Render вибери **New → Blueprint**, під’єднай GitHub і вибери `Guardianec/studentwatch` та гілку `main`. Blueprint створить один сервіс із планом `free`. У запитаних змінних введи `POSTUP_DATABASE_URL` з Neon і `DJANGO_SECRET_KEY`, згенерований командою нижче. Збережи ключ у менеджері паролів для першого запуску адміністратора. [Render Dashboard](https://dashboard.render.com/) · [Render Blueprints](https://render.com/docs/blueprint-spec)

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(64))"
   ```

4. Після першого розгортання відкрий HTTPS-адресу, яку дав Render. Звір версію в `/api/health/`, а також відкрий учнівську форму і `/admin/`. Команда запуску контейнера застосовує міграції до тієї самої бази Neon.

Команди для першого коміту пілоту запускай після перевірки списку файлів:

```powershell
git status --short
git add -A
git diff --cached --stat
git commit -m "Підготувати Поступ 0.2.0 до онлайн-пілоту"
git push origin main
```

## Перший адміністратор

В окремому вікні PowerShell 7 з кореня проєкту встанови залежності та запусти Django-команду для **онлайн-бази**. Вводь два секрети в прихованих запитах. Ім’я хоста вкажи без `https://`.

```powershell
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
$env:POSTUP_MODE = 'production'
$env:POSTUP_ALLOWED_HOSTS = Read-Host 'Хост Render, наприклад postup-pilot.onrender.com'
$env:POSTUP_DATABASE_URL = Read-Host -MaskInput 'Пряма адреса PostgreSQL з Neon'
$env:DJANGO_SECRET_KEY = Read-Host -MaskInput 'Секретний ключ із Render'
.\.venv\Scripts\python.exe server/manage.py createsuperuser
```

Закрий це вікно після створення акаунта. Увійди в онлайн-`/admin/` точним логіном адміністратора й створи окремий акаунт із роллю «Учитель». Для входу вчителю потрібні цей акаунт та інсталятор.

## Збірка й перевірка кожної версії

Після успішного розгортання підстав видану Render HTTPS-адресу в обидві змінні та збери інсталятор. Так Windows-клієнт отримає адресу API й створюватиме посилання на онлайн-сайт.

```powershell
$env:POSTUP_API_ORIGIN = Read-Host 'HTTPS-адреса сервісу Render'
$env:VITE_STUDENT_ORIGIN = $env:POSTUP_API_ORIGIN
npm.cmd ci
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc
```

1. Розробляй у гілці й зливай готову версію в `main`. Render розгортає цей коміт після успішних GitHub-перевірок. Для кожного релізу узгодь номер у Django, `package.json` і Tauri. [Умови автоматичного розгортання Render](https://render.com/docs/deploys#integrating-with-ci)
2. Відкрий онлайн-сайт, створи тестову групу в Windows і перевір заявку учня через справжнє HTTPS-запрошення. Передай учителю інсталятор цієї версії та його дані входу окремо.
3. Після перевірки вчитель відкриває **Налаштування → Перевірка версії → Вподобати версію**. Адміністратор бачить версію, акаунт учителя й час у **Підтвердженнях версій** онлайн-адмінки. Вподобайка зберігається один раз на вчителя й номер версії.

Для першого розгортання можна скористатися вже налаштованим GitHub-репозиторієм. Якщо репозиторій приватний, під час підключення дай Render доступ саме до `studentwatch`. Доступ учителя до вихідного коду потрібен лише за окремим бажанням переглядати код.

## Межі безкоштовного пілоту

Render Free засинає після 15 хвилин без запитів. Перше відкриття після паузи може тривати близько хвилини. Один сервіс використовує ліміт 750 годин на місяць у межах робочого простору. Перевіряй також використання трафіку та хвилин збірок. Для пілоту залиш тарифи Free та стеж за включеними лімітами. [Обмеження Render Free](https://render.com/docs/free)

За поточним тарифом Neon Free дає 1 ГБ зберігання і 100 CU-годин на місяць на проєкт. База зберігається незалежно від циклу запуску Render. Під час простою обчислювальні ресурси Neon засинають. [Тарифи Neon](https://neon.com/pricing)
