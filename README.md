# Поступ

Робочий простір учителя для перегляду олімпіад, конкурсів і дослідницьких робіт учнів. Версія **0.1.0** містить Windows-оболонку, демонстраційні портфоліо та мінімальний сервер. Усі імена, результати й дати в інтерфейсі вигадані.

## Перегляд у браузері

Потрібен Node.js 22.12 або новіший. У PowerShell з кореня проєкту виконайте:

```powershell
npm.cmd ci
npm.cmd run dev
```

Відкрийте http://127.0.0.1:1420. Для перегляду демо достатньо клієнта. Щоб перевірити підключення, у другому вікні PowerShell запустіть сервер із Python 3.12 або новішим:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\.venv\Scripts\python.exe server/manage.py runserver 127.0.0.1:8000
```

У «Налаштуваннях» натисніть «Перевірити зв’язок». Статус «Сервер відповідає» означає, що клієнт отримав коректну відповідь від API перевірки доступності. Демозаписи завжди читаються з пакета клієнта.

## Збірка для Windows x64

Для збірки потрібні Rust із ціллю `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools, Windows SDK та WebView2. Перелік компонентів є в [інструкції Tauri](https://v2.tauri.app/start/prerequisites/#windows).

```powershell
npm.cmd ci
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc
```

Інсталятор NSIS з’явиться у `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Для запуску вже зібраної програми потрібен WebView2. Якщо його бракує, інсталятор налаштовано завантажити його з Microsoft. Інсталятор і виконувані файли збірки залишаються поза Git.

## Перевірки та документація

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe server/manage.py test postup
```

- [Вимоги й сценарії](docs/REQUIREMENTS.md)
- [Архітектура та схема даних](docs/ARCHITECTURE.md)
- [Правила дизайну і джерела](docs/DESIGN.md)
- [Стан версії та ручна перевірка](docs/STATUS.md)
- [Публікація коду на GitHub](docs/PUBLISH.md)
- [Дорожня карта](ROADMAP.md) · [Журнал змін](CHANGELOG.md)
