# Поступ

«Поступ» — академічний простір для учнів і вчителів. У **0.4.1** учитель у Windows бачить академічний огляд, знаходить учнів і результати в окремих каталогах та розглядає подання й заявки у вхідних. Учень на сайті веде особисте портфоліо, подає досягнення вибраним групам, відповідає на зауваження й додає дипломи за потреби. Історія зберігає попередні рішення та виправлення.

Обидва кабінети використовують React, TypeScript і Vite. Tauri надає учительський клієнт для Windows, Django обслуговує API, а PostgreSQL зберігає записи й приватні вкладення незалежно від стану клієнта.

## Локальний запуск

Для розробки потрібні Python 3.12+ і Node.js 22.12+. У PowerShell з кореня проєкту підготуйте сервер і створіть адміністратора:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\.venv\Scripts\python.exe server/manage.py migrate
.\.venv\Scripts\python.exe server/manage.py createsuperuser
.\.venv\Scripts\python.exe server/manage.py runserver 127.0.0.1:8000 --insecure
```

Локально Django за замовчуванням використовує SQLite. Відкрийте http://127.0.0.1:8000/admin/ та додайте користувача з роллю «Учитель». У другому вікні PowerShell запустіть учнівський сайт:

```powershell
npm.cmd ci
npm.cmd run dev
```

Учнівський сайт відкривається на http://127.0.0.1:1420, а Vite проксіює `/api/` до Django. Для перевірки вчителя запустіть зібраний Windows-застосунок. `npm.cmd run tauri -- dev` також відкриває учительський клієнт. Для цього спочатку звільніть порт 1420 від окремого Vite. Параметри production наведено в [інструкції розгортання](docs/DEPLOYMENT.md).

## Збірка для Windows x64

Для збірки потрібні Rust із ціллю `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools, Windows SDK та WebView2. Перелік компонентів є в [інструкції Tauri](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
npm.cmd ci
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc
```

Інсталятор NSIS з’явиться у `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Для запуску вже зібраної програми потрібен WebView2. Якщо його бракує, інсталятор налаштовано завантажити його з Microsoft. Інсталятор і виконувані файли збірки залишаються поза Git.

Збірка без додаткових змінних використовує локальний Django на порту 8000 і створює запрошення на порт 1420. Для онлайн-пілоту задайте `POSTUP_API_ORIGIN` та `VITE_STUDENT_ORIGIN` перед збіркою. Windows-клієнт звертається до налаштованої адреси, а Django і база запускаються окремо.

## Перевірки та документація

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe server/manage.py test postup
```

- [Вимоги й сценарії](docs/REQUIREMENTS.md)
- [Архітектура та схема даних](docs/ARCHITECTURE.md)
- [Правила дизайну і джерела](docs/DESIGN.md)
- [Аудит 0.4.0](docs/ux-audit-0.4.1.md) · [Дослідження дизайну](docs/design-research-0.4.1.md) · [Результати перевірки 0.4.1](docs/usability-results-0.4.1.md)
- [Розгортання сервера й учнівського сайту](docs/DEPLOYMENT.md)
- [Безкоштовний онлайн-пілот і перевірка версій учителем](docs/PILOT.md)
- [Оновлення репозиторію на GitHub](docs/PUBLISH.md)
- [Дорожня карта](ROADMAP.md) · [Журнал змін](CHANGELOG.md)
