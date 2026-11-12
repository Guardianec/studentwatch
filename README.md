# Поступ

«Поступ» — система академічних досягнень учнів. У **0.3.0** учень веде академічний профіль, зберігає чернетки й подає індивідуальні або командні результати вибраним групам. Диплом можна додати пізніше. Учитель керує групами й переглядає надані результати у Windows-програмі. Дані та приватні вкладення зберігаються на центральному сервері незалежно від стану програми вчителя.

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
- [Стан версії та ручна перевірка](docs/STATUS.md)
- [Розгортання сервера й учнівського сайту](docs/DEPLOYMENT.md)
- [Безкоштовний онлайн-пілот і перевірка версій учителем](docs/PILOT.md)
- [Оновлення репозиторію на GitHub](docs/PUBLISH.md)
- [Дорожня карта](ROADMAP.md) · [Журнал змін](CHANGELOG.md)
